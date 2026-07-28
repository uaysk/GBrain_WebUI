import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ControlActionJob,
  ControlActionName,
  ControlActionRequest,
  ControlActionResult,
  ControlJobStatus,
} from "../src/types";
import type { Config } from "./config";

type JsonRecord = Record<string, unknown>;
type ControlActionConfig = Config["controlCenter"] & {
  mutationsEnabled: boolean;
  actionLedgerPath: string | null;
};

type ToolName =
  | "sources_list"
  | "sources_status"
  | "get_status_snapshot"
  | "list_jobs"
  | "get_job"
  | "submit_job"
  | "retry_job"
  | "cancel_job";

type MutationPlan =
  | {
    kind: "submit";
    tool: "submit_job";
    arguments: {
      name: "autopilot-cycle" | "sync" | "embed";
      data: JsonRecord;
      queue: "default";
      priority: 0 | 5;
      max_attempts: 2 | 3;
      timeout_ms: 600_000 | 1_800_000;
    };
    expectedName: "autopilot-cycle" | "sync" | "embed";
    expectedData: JsonRecord;
    expectedQueue: "default";
    expectedPriority: 0 | 5;
    expectedMaxAttempts: 2 | 3;
    expectedTimeoutMs: 600_000 | 1_800_000;
    sourceId: string;
  }
  | {
    kind: "existing-job";
    tool: "retry_job" | "cancel_job";
    arguments: { id: number };
    expectedName: "autopilot-cycle" | "sync" | "embed";
    expectedData: JsonRecord;
    expectedQueue: "default";
    expectedPriority: 0 | 5;
    expectedMaxAttempts: 2 | 3;
    expectedTimeoutMs: 600_000 | 1_800_000;
    sourceId: string;
    jobId: number;
  };

interface LedgerRecord {
  actionId: string;
  idempotencyKey: string;
  requestHash: string;
  action: ControlActionName;
  target: string;
  actorHash?: string;
  createdAt: string;
  expiresAt: string;
  result: ControlActionResult;
}

interface LedgerDocument {
  version: 1;
  records: LedgerRecord[];
}

interface ServiceOptions {
  now?: () => number;
  createId?: () => string;
  cooldownMs?: number;
}

interface SourceFacts {
  id: string;
  remoteUrl: string | null;
  cloneState: string;
  localPathPresent: boolean;
}

interface PrecheckResult {
  plan: MutationPlan;
  existingJob: ControlActionJob | null;
}

export interface ControlActionConnector {
  callTool(name: ToolName, args: JsonRecord): Promise<unknown>;
  close?(): Promise<void>;
}

const LEDGER_VERSION = 1;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_COOLDOWN_MS = 10_000;
const SOURCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR_HASH_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ACTIVE_JOB_STATUSES = new Set([
  "waiting",
  "waiting-children",
  "paused",
  "active",
  "delayed",
]);
const KNOWN_JOB_STATUSES = new Set<ControlJobStatus>([
  "waiting",
  "waiting-children",
  "paused",
  "active",
  "completed",
  "failed",
  "delayed",
  "dead",
  "cancelled",
  "unknown",
]);

const JOB_LABELS: Record<string, string> = {
  "autopilot-cycle": "빠른 Dream",
  sync: "소스 동기화",
  embed: "Embedding 갱신",
};

const ACTION_MESSAGES: Record<ControlActionName, string> = {
  "quick-dream": "빠른 Dream 작업을 접수했습니다.",
  "source-sync": "소스 동기화 작업을 접수했습니다.",
  "embedding-refresh": "Embedding 갱신 작업을 접수했습니다.",
  "job-retry": "작업 재시도를 접수했습니다.",
  "job-cancel": "작업 취소를 접수했습니다.",
};

const PENDING_MESSAGE = "요청을 기록했으며 GBrain의 반영 여부를 확인하고 있습니다.";

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jobStatus(value: unknown): ControlJobStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() as ControlJobStatus : "unknown";
  return KNOWN_JOB_STATUSES.has(normalized) ? normalized : "unknown";
}

function jobSourceId(job: JsonRecord): string | null {
  const data = record(job.data);
  const value = typeof data.sourceId === "string"
    ? data.sourceId
    : typeof data.source_id === "string"
      ? data.source_id
      : null;
  return value && SOURCE_ID_PATTERN.test(value) ? value : null;
}

function normalizeJob(
  value: unknown,
  allowedSourceIds: ReadonlySet<string>,
): ControlActionJob | null {
  const job = record(value);
  const id = positiveInteger(job.id);
  const name = typeof job.name === "string" && Object.hasOwn(JOB_LABELS, job.name)
    ? job.name
    : null;
  const sourceId = jobSourceId(job);
  if (!id || !name || !sourceId || !allowedSourceIds.has(sourceId)) return null;
  return {
    id,
    name,
    label: JOB_LABELS[name],
    status: jobStatus(job.status ?? job.state),
    sourceId,
    createdAt: safeIso(job.created_at ?? job.createdAt),
  };
}

function decodeToolPayload(value: unknown): unknown {
  const result = record(value);
  if (result.isError === true) throw new Error("GBrain MCP tool failed");
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  if (Array.isArray(result.content)) {
    const textBlock = result.content
      .map(record)
      .find((item) => item.type === "text" && typeof item.text === "string");
    if (!textBlock) throw new Error("GBrain MCP tool returned no structured response");
    try {
      return JSON.parse(textBlock.text as string);
    } catch {
      throw new Error("GBrain MCP tool returned invalid JSON");
    }
  }
  return value;
}

function expectedConfirmation(request: ControlActionRequest): string {
  switch (request.action) {
    case "quick-dream":
      return `RUN ${request.sourceId}`;
    case "source-sync":
      return `SYNC ${request.sourceId}`;
    case "embedding-refresh":
      return `EMBED ${request.sourceId}`;
    case "job-retry":
      return `RETRY #${request.jobId}`;
    case "job-cancel":
      return `CANCEL #${request.jobId}`;
  }
}

function validateRequest(value: unknown): ControlActionRequest {
  const body = record(value);
  const action = body.action;
  if (
    action === "quick-dream"
    || action === "source-sync"
    || action === "embedding-refresh"
  ) {
    if (!exactKeys(body, ["action", "sourceId", "confirmation"])) {
      throw new ControlActionError(400, "invalid_request", "허용되지 않은 요청 필드가 있습니다.");
    }
    if (typeof body.sourceId !== "string" || !SOURCE_ID_PATTERN.test(body.sourceId)) {
      throw new ControlActionError(400, "invalid_source", "올바른 소스 ID가 필요합니다.");
    }
    if (typeof body.confirmation !== "string") {
      throw new ControlActionError(400, "invalid_confirmation", "확인 문구가 필요합니다.");
    }
    const request = body as unknown as ControlActionRequest;
    if (request.confirmation !== expectedConfirmation(request)) {
      throw new ControlActionError(400, "invalid_confirmation", "확인 문구가 일치하지 않습니다.");
    }
    return request;
  }

  if (action === "job-retry" || action === "job-cancel") {
    if (!exactKeys(body, ["action", "jobId", "expectedStatus", "confirmation"])) {
      throw new ControlActionError(400, "invalid_request", "허용되지 않은 요청 필드가 있습니다.");
    }
    const jobId = positiveInteger(body.jobId);
    if (!jobId) throw new ControlActionError(400, "invalid_job", "올바른 작업 ID가 필요합니다.");
    const validExpected = action === "job-retry"
      ? body.expectedStatus === "failed" || body.expectedStatus === "dead"
      : body.expectedStatus === "waiting" || body.expectedStatus === "delayed";
    if (!validExpected) {
      throw new ControlActionError(400, "invalid_expected_status", "작업 상태 조건이 올바르지 않습니다.");
    }
    if (typeof body.confirmation !== "string") {
      throw new ControlActionError(400, "invalid_confirmation", "확인 문구가 필요합니다.");
    }
    const request = body as unknown as ControlActionRequest;
    if (request.confirmation !== expectedConfirmation(request)) {
      throw new ControlActionError(400, "invalid_confirmation", "확인 문구가 일치하지 않습니다.");
    }
    return request;
  }

  throw new ControlActionError(400, "invalid_action", "지원하지 않는 관리 작업입니다.");
}

function canonicalRequest(request: ControlActionRequest): string {
  if ("sourceId" in request) {
    return JSON.stringify({
      action: request.action,
      sourceId: request.sourceId,
      confirmation: request.confirmation,
    });
  }
  return JSON.stringify({
    action: request.action,
    jobId: request.jobId,
    expectedStatus: request.expectedStatus,
    confirmation: request.confirmation,
  });
}

function requestTarget(request: ControlActionRequest): string {
  return "sourceId" in request ? `source:${request.sourceId}` : `job:${request.jobId}`;
}

function requestHash(request: ControlActionRequest): string {
  return createHash("sha256").update(canonicalRequest(request)).digest("hex");
}

function safeActorHash(value: string | undefined): string | undefined {
  return value && ACTOR_HASH_PATTERN.test(value) ? value : undefined;
}

function sourceList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wrapper = record(value);
  return Array.isArray(wrapper.sources) ? wrapper.sources : [];
}

function jobList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wrapper = record(value);
  return Array.isArray(wrapper.jobs) ? wrapper.jobs : [];
}

function sourceIdFromListEntry(value: unknown): string | null {
  const source = record(value);
  return typeof source.id === "string" && SOURCE_ID_PATTERN.test(source.id) ? source.id : null;
}

function activeSourceJob(jobs: unknown[], sourceId: string): boolean {
  return jobs.some((value) => {
    const job = record(value);
    if (!ACTIVE_JOB_STATUSES.has(String(job.status ?? job.state).toLowerCase())) return false;
    if (!["autopilot-cycle", "sync", "embed"].includes(String(job.name))) return false;
    const currentSourceId = jobSourceId(job);
    return currentSourceId === sourceId || (job.name === "autopilot-cycle" && currentSourceId === null);
  });
}

function sourceSyncEnabled(snapshot: unknown, sourceId: string): boolean {
  const sync = record(record(snapshot).sync);
  const sources = Array.isArray(sync.sources) ? sync.sources : [];
  const source = sources.map(record).find((item) => item.source_id === sourceId || item.id === sourceId);
  return Boolean(source) && source?.sync_enabled !== false;
}

function safeFixedJob(
  value: unknown,
  sources: Map<string, SourceFacts>,
): { name: "autopilot-cycle" | "sync" | "embed"; sourceId: string } | null {
  const job = record(value);
  const data = record(job.data);
  if (job.name === "sync") {
    if (!exactKeys(data, [
      "sourceId",
      "noPull",
      "noEmbed",
      "noExtract",
      "auto_embed_backfill",
      "embed_reason",
    ])) return null;
    if (typeof data.sourceId !== "string") return null;
    const source = sources.get(data.sourceId);
    if (!source) return null;
    const expectedNoPull = source.remoteUrl === null;
    if (
      data.noPull !== expectedNoPull
      || data.noEmbed !== true
      || data.noExtract !== true
      || data.auto_embed_backfill !== true
      || data.embed_reason !== "webui_manual"
      || job.queue !== "default"
      || job.priority !== 0
      || job.max_attempts !== 2
      || job.timeout_ms !== 600_000
    ) return null;
    return { name: "sync", sourceId: data.sourceId };
  }
  if (job.name === "embed") {
    if (!exactKeys(data, ["sourceId", "stale"])) return null;
    if (
      typeof data.sourceId !== "string"
      || !sources.has(data.sourceId)
      || data.stale !== true
      || job.queue !== "default"
      || job.priority !== 5
      || job.max_attempts !== 3
      || job.timeout_ms !== 1_800_000
    ) return null;
    return { name: "embed", sourceId: data.sourceId };
  }
  if (job.name === "autopilot-cycle") {
    if (!exactKeys(data, ["source_id", "phases", "pull"])) return null;
    if (
      typeof data.source_id !== "string"
      || !sources.has(data.source_id)
      || !Array.isArray(data.phases)
      || data.phases.length !== 3
      || data.phases[0] !== "sync"
      || data.phases[1] !== "extract"
      || data.phases[2] !== "embed"
      || data.pull !== false
      || job.queue !== "default"
      || job.priority !== 0
      || job.max_attempts !== 2
      || job.timeout_ms !== 600_000
    ) return null;
    return { name: "autopilot-cycle", sourceId: data.source_id };
  }
  return null;
}

function resultMessage(action: ControlActionName, outcome: ControlActionResult["outcome"]): string {
  return outcome === "accepted" ? ACTION_MESSAGES[action] : PENDING_MESSAGE;
}

function fixedValueEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => fixedValueEqual(actual[index], value));
  }
  if (expected !== null && typeof expected === "object") {
    const actualRecord = record(actual);
    const expectedRecord = expected as JsonRecord;
    return exactKeys(actualRecord, Object.keys(expectedRecord))
      && Object.entries(expectedRecord).every(([key, value]) => fixedValueEqual(actualRecord[key], value));
  }
  return actual === expected;
}

function pendingResult(
  actionId: string,
  action: ControlActionName,
  generatedAt: string,
  job: ControlActionJob | null,
): ControlActionResult {
  return {
    actionId,
    action,
    outcome: "pending-verification",
    replayed: false,
    message: resultMessage(action, "pending-verification"),
    generatedAt,
    job,
  };
}

function acceptedResult(
  actionId: string,
  action: ControlActionName,
  generatedAt: string,
  job: ControlActionJob,
): ControlActionResult {
  return {
    actionId,
    action,
    outcome: "accepted",
    replayed: false,
    message: resultMessage(action, "accepted"),
    generatedAt,
    job,
  };
}

function replayResult(result: ControlActionResult): ControlActionResult {
  return { ...result, replayed: true };
}

function validStoredJob(value: unknown): value is ControlActionJob {
  const job = record(value);
  const name = typeof job.name === "string" ? job.name : "";
  return (
    exactKeys(job, ["id", "name", "label", "status", "sourceId", "createdAt"])
    && positiveInteger(job.id) !== null
    && Object.hasOwn(JOB_LABELS, name)
    && job.label === JOB_LABELS[name]
    && KNOWN_JOB_STATUSES.has(job.status as ControlJobStatus)
    && typeof job.sourceId === "string"
    && SOURCE_ID_PATTERN.test(job.sourceId)
    && (job.createdAt === null || safeIso(job.createdAt) !== null)
  );
}

function validStoredResult(value: unknown): value is ControlActionResult {
  const result = record(value);
  const action = result.action as ControlActionName;
  const outcome = result.outcome as ControlActionResult["outcome"];
  return (
    exactKeys(result, ["actionId", "action", "outcome", "replayed", "message", "generatedAt", "job"])
    && typeof result.actionId === "string"
    && result.actionId.length > 0
    && result.actionId.length <= 128
    && Object.hasOwn(ACTION_MESSAGES, action)
    && (outcome === "accepted" || outcome === "pending-verification")
    && result.replayed === false
    && result.message === resultMessage(action, outcome)
    && safeIso(result.generatedAt) !== null
    && (
      (result.job === null && outcome === "pending-verification")
      || validStoredJob(result.job)
    )
  );
}

function validLedgerRecord(value: unknown): value is LedgerRecord {
  const entry = record(value);
  const allowedKeys = entry.actorHash === undefined
    ? ["actionId", "idempotencyKey", "requestHash", "action", "target", "createdAt", "expiresAt", "result"]
    : ["actionId", "idempotencyKey", "requestHash", "action", "target", "actorHash", "createdAt", "expiresAt", "result"];
  const result = record(entry.result);
  return (
    exactKeys(entry, allowedKeys)
    && typeof entry.actionId === "string"
    && UUID_V4_PATTERN.test(String(entry.idempotencyKey))
    && /^[a-f0-9]{64}$/.test(String(entry.requestHash))
    && Object.hasOwn(ACTION_MESSAGES, String(entry.action))
    && /^(source:[a-z0-9-]{1,32}|job:[1-9][0-9]*)$/.test(String(entry.target))
    && (entry.actorHash === undefined || ACTOR_HASH_PATTERN.test(String(entry.actorHash)))
    && safeIso(entry.createdAt) !== null
    && safeIso(entry.expiresAt) !== null
    && validStoredResult(entry.result)
    && result.actionId === entry.actionId
    && result.action === entry.action
  );
}

export class ControlActionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ControlActionError";
  }
}

export function parseControlActionRequest(raw: string): ControlActionRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ControlActionError(400, "invalid_json", "올바른 JSON 요청이 필요합니다.");
  }
  return validateRequest(value);
}

export function parseControlActionIdempotencyKey(value: string | null | undefined): string {
  if (!value || !UUID_V4_PATTERN.test(value)) {
    throw new ControlActionError(
      400,
      "invalid_idempotency_key",
      "UUID v4 형식의 Idempotency-Key가 필요합니다.",
    );
  }
  return value;
}

export class McpControlActionConnector implements ControlActionConnector {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  private async connectedClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      });
      const client = new Client(
        { name: "gbrain-webui-control-actions", version: "1.0.0" },
        { capabilities: {} },
      );
      await client.connect(transport, { timeout: this.timeoutMs });
      this.transport = transport;
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async callTool(name: ToolName, args: JsonRecord): Promise<unknown> {
    try {
      const client = await this.connectedClient();
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: this.timeoutMs },
      );
      return decodeToolPayload(result);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    if (client) await client.close().catch(() => undefined);
  }
}

export class ControlActionService {
  private readonly allowedSourceIds: ReadonlySet<string>;
  private readonly connector: ControlActionConnector | null;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly cooldownMs: number;
  private readonly activeTargets = new Set<string>();
  private memoryLedger: LedgerDocument = { version: LEDGER_VERSION, records: [] };
  private ledgerTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ControlActionConfig,
    allowedSourceIds: readonly string[],
    connector?: ControlActionConnector,
    options: ServiceOptions = {},
  ) {
    this.allowedSourceIds = new Set(allowedSourceIds);
    this.connector = connector ?? (
      config.mcpUrl && config.mcpToken
        ? new McpControlActionConnector(config.mcpUrl, config.mcpToken, config.requestTimeoutMs)
        : null
    );
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  get enabled(): boolean {
    return this.config.mutationsEnabled && this.connector !== null;
  }

  async close(): Promise<void> {
    await this.connector?.close?.();
  }

  async execute(
    rawRequest: ControlActionRequest,
    rawIdempotencyKey: string,
    actorHash?: string,
  ): Promise<ControlActionResult> {
    const request = validateRequest(rawRequest);
    const idempotencyKey = parseControlActionIdempotencyKey(rawIdempotencyKey);
    if (!this.config.mutationsEnabled) {
      throw new ControlActionError(403, "management_disabled", "GBrain 관리 작업이 비활성화되어 있습니다.");
    }
    if (!this.connector) {
      throw new ControlActionError(503, "control_unavailable", "GBrain 관리 연결을 사용할 수 없습니다.");
    }
    if ("sourceId" in request && !this.allowedSourceIds.has(request.sourceId)) {
      throw new ControlActionError(403, "source_not_allowed", "관리 허용 목록에 없는 소스입니다.");
    }

    const hash = requestHash(request);
    const target = requestTarget(request);
    const actionTarget = `${request.action}:${target}`;
    const earlyReplay = await this.withLedgerLock(async () => {
      const ledger = await this.loadLedger();
      const existing = ledger.records.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (!existing) return null;
      if (existing.requestHash !== hash) {
        throw new ControlActionError(
          409,
          "idempotency_conflict",
          "같은 Idempotency-Key가 다른 요청에 이미 사용되었습니다.",
        );
      }
      return replayResult(existing.result);
    });
    if (earlyReplay) return earlyReplay;

    if (this.activeTargets.has(target)) {
      throw new ControlActionError(409, "action_in_progress", "같은 대상의 관리 작업이 이미 진행 중입니다.");
    }
    this.activeTargets.add(target);

    try {
      const precheck = await this.precheck(request);
      const createdAtMs = this.now();
      const createdAt = new Date(createdAtMs).toISOString();
      const actionId = this.createId();
      const initialResult = pendingResult(actionId, request.action, createdAt, precheck.existingJob);

      const reservation = await this.withLedgerLock(async () => {
        const ledger = await this.loadLedger();
        const existing = ledger.records.find((entry) => entry.idempotencyKey === idempotencyKey);
        if (existing) {
          if (existing.requestHash !== hash) {
            throw new ControlActionError(
              409,
              "idempotency_conflict",
              "같은 Idempotency-Key가 다른 요청에 이미 사용되었습니다.",
            );
          }
          return replayResult(existing.result);
        }
        const latest = ledger.records
          .filter((entry) => `${entry.action}:${entry.target}` === actionTarget)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
        if (latest) {
          const remainingMs = this.cooldownMs - (createdAtMs - Date.parse(latest.createdAt));
          if (remainingMs > 0) {
            const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
            throw new ControlActionError(
              429,
              "action_cooldown",
              "같은 관리 작업을 다시 실행하려면 잠시 기다려 주세요.",
              retryAfterSeconds,
            );
          }
        }
        ledger.records.push({
          actionId,
          idempotencyKey,
          requestHash: hash,
          action: request.action,
          target,
          actorHash: safeActorHash(actorHash),
          createdAt,
          expiresAt: new Date(createdAtMs + IDEMPOTENCY_TTL_MS).toISOString(),
          result: initialResult,
        });
        await this.saveLedger(ledger);
        return null;
      });
      if (reservation) return reservation;

      let result = initialResult;
      try {
        const mutation = await this.connector.callTool(precheck.plan.tool, precheck.plan.arguments);
        const verified = await this.verifyMutation(precheck.plan, mutation);
        if (verified) result = acceptedResult(actionId, request.action, createdAt, verified);
      } catch {
        // The mutation may have crossed the network before the failure became
        // observable. Keep the durable pending record and never retry it
        // automatically; a same-key replay returns this safe state.
      }

      await this.withLedgerLock(async () => {
        const ledger = await this.loadLedger();
        const entry = ledger.records.find((item) => item.idempotencyKey === idempotencyKey);
        if (entry && entry.requestHash === hash) {
          entry.result = result;
          await this.saveLedger(ledger);
        }
      });
      return result;
    } finally {
      this.activeTargets.delete(target);
    }
  }

  private async precheck(request: ControlActionRequest): Promise<PrecheckResult> {
    let sourcesPayload: unknown;
    let snapshot: unknown;
    let recentJobs: unknown[];
    try {
      const precheckResults = await Promise.all([
        this.connector!.callTool("sources_list", { include_archived: true }),
        this.connector!.callTool("get_status_snapshot", {}),
        ...["waiting", "waiting-children", "paused", "active", "delayed"].map((status) =>
          this.connector!.callTool("list_jobs", { status, limit: 500 })),
      ]);
      [sourcesPayload, snapshot] = precheckResults;
      recentJobs = precheckResults.slice(2);
    } catch {
      throw new ControlActionError(503, "precheck_unavailable", "GBrain의 현재 상태를 확인할 수 없습니다.");
    }
    if (Object.keys(record(snapshot)).length === 0) {
      throw new ControlActionError(503, "precheck_invalid", "GBrain 상태 응답을 확인할 수 없습니다.");
    }
    const listedSources = sourceList(sourcesPayload);
    const jobs = recentJobs.flatMap(jobList);

    if ("sourceId" in request) {
      const source = await this.loadSourceFacts(request.sourceId, listedSources);
      if (
        (request.action === "quick-dream" || request.action === "source-sync")
        && !sourceSyncEnabled(snapshot, request.sourceId)
      ) {
        throw new ControlActionError(409, "source_sync_disabled", "이 소스의 동기화가 비활성화되어 있습니다.");
      }
      if (activeSourceJob(jobs, request.sourceId)) {
        throw new ControlActionError(409, "source_busy", "이 소스에서 다른 관리 작업이 실행 중입니다.");
      }
      if (request.action === "source-sync") {
        if (!source.localPathPresent || source.cloneState !== "healthy") {
          throw new ControlActionError(409, "source_not_syncable", "이 소스는 현재 안전하게 동기화할 수 없습니다.");
        }
        return {
          existingJob: null,
          plan: {
            kind: "submit",
            tool: "submit_job",
            arguments: {
              name: "sync",
              data: {
                sourceId: source.id,
                noPull: source.remoteUrl === null,
                noEmbed: true,
                noExtract: true,
                auto_embed_backfill: true,
                embed_reason: "webui_manual",
              },
              queue: "default",
              priority: 0,
              max_attempts: 2,
              timeout_ms: 600_000,
            },
            expectedName: "sync",
            expectedData: {
              sourceId: source.id,
              noPull: source.remoteUrl === null,
              noEmbed: true,
              noExtract: true,
              auto_embed_backfill: true,
              embed_reason: "webui_manual",
            },
            expectedQueue: "default",
            expectedPriority: 0,
            expectedMaxAttempts: 2,
            expectedTimeoutMs: 600_000,
            sourceId: source.id,
          },
        };
      }
      if (request.action === "embedding-refresh") {
        return {
          existingJob: null,
          plan: {
            kind: "submit",
            tool: "submit_job",
            arguments: {
              name: "embed",
              data: { sourceId: source.id, stale: true },
              queue: "default",
              priority: 5,
              max_attempts: 3,
              timeout_ms: 1_800_000,
            },
            expectedName: "embed",
            expectedData: { sourceId: source.id, stale: true },
            expectedQueue: "default",
            expectedPriority: 5,
            expectedMaxAttempts: 3,
            expectedTimeoutMs: 1_800_000,
            sourceId: source.id,
          },
        };
      }
      return {
        existingJob: null,
        plan: {
          kind: "submit",
          tool: "submit_job",
          arguments: {
            name: "autopilot-cycle",
            data: {
              source_id: source.id,
              phases: ["sync", "extract", "embed"],
              pull: false,
            },
            queue: "default",
            priority: 0,
            max_attempts: 2,
            timeout_ms: 600_000,
          },
          expectedName: "autopilot-cycle",
          expectedData: {
            source_id: source.id,
            phases: ["sync", "extract", "embed"],
            pull: false,
          },
          expectedQueue: "default",
          expectedPriority: 0,
          expectedMaxAttempts: 2,
          expectedTimeoutMs: 600_000,
          sourceId: source.id,
        },
      };
    }

    let rawJob: unknown;
    try {
      rawJob = await this.connector!.callTool("get_job", { id: request.jobId });
    } catch {
      throw new ControlActionError(503, "job_precheck_unavailable", "작업의 현재 상태를 확인할 수 없습니다.");
    }
    const job = record(rawJob);
    if (positiveInteger(job.id) !== request.jobId) {
      throw new ControlActionError(404, "job_not_found", "작업을 찾을 수 없습니다.");
    }
    const currentStatus = jobStatus(job.status ?? job.state);
    if (currentStatus !== request.expectedStatus) {
      throw new ControlActionError(409, "stale_job_status", "작업 상태가 화면에 표시된 값과 달라졌습니다.");
    }
    const sourceId = jobSourceId(job);
    if (!sourceId || !this.allowedSourceIds.has(sourceId)) {
      throw new ControlActionError(403, "source_not_allowed", "관리 허용 목록에 없는 작업입니다.");
    }
    const source = await this.loadSourceFacts(sourceId, listedSources);
    const sourceMap = new Map([[sourceId, source]]);
    const safeJob = safeFixedJob(job, sourceMap);
    if (!safeJob) {
      throw new ControlActionError(409, "unsafe_job_payload", "고정된 안전 작업만 재시도하거나 취소할 수 있습니다.");
    }
    const existingJob = normalizeJob(job, this.allowedSourceIds);
    if (!existingJob) {
      throw new ControlActionError(409, "invalid_job_shape", "작업 정보를 안전하게 확인할 수 없습니다.");
    }
    if (request.action === "job-retry" && currentStatus !== "failed" && currentStatus !== "dead") {
      throw new ControlActionError(409, "job_not_retryable", "실패하거나 중단된 작업만 재시도할 수 있습니다.");
    }
    if (request.action === "job-retry" && safeJob.name === "autopilot-cycle") {
      throw new ControlActionError(409, "unsafe_job_payload", "빠른 Dream은 자동 재시도하지 않고 새 실행으로만 시작할 수 있습니다.");
    }
    if (request.action === "job-cancel" && currentStatus !== "waiting" && currentStatus !== "delayed") {
      throw new ControlActionError(409, "job_not_cancellable", "대기 또는 지연 중인 작업만 취소할 수 있습니다.");
    }
    return {
      existingJob,
      plan: {
        kind: "existing-job",
        tool: request.action === "job-retry" ? "retry_job" : "cancel_job",
        arguments: { id: request.jobId },
        expectedName: safeJob.name,
        expectedData: safeJob.name === "sync"
          ? {
            sourceId,
            noPull: source.remoteUrl === null,
            noEmbed: true,
            noExtract: true,
            auto_embed_backfill: true,
            embed_reason: "webui_manual",
          }
          : safeJob.name === "embed"
            ? { sourceId, stale: true }
            : {
              source_id: sourceId,
              phases: ["sync", "extract", "embed"],
              pull: false,
            },
        expectedQueue: "default",
        expectedPriority: safeJob.name === "embed" ? 5 : 0,
        expectedMaxAttempts: safeJob.name === "embed" ? 3 : 2,
        expectedTimeoutMs: safeJob.name === "embed" ? 1_800_000 : 600_000,
        sourceId: safeJob.sourceId,
        jobId: request.jobId,
      },
    };
  }

  private async loadSourceFacts(sourceId: string, listedSources: unknown[]): Promise<SourceFacts> {
    if (!this.allowedSourceIds.has(sourceId)) {
      throw new ControlActionError(403, "source_not_allowed", "관리 허용 목록에 없는 소스입니다.");
    }
    const listed = listedSources.map(record).find((value) => sourceIdFromListEntry(value) === sourceId);
    if (!listed) throw new ControlActionError(404, "source_not_found", "GBrain 소스를 찾을 수 없습니다.");

    let statusPayload: unknown;
    try {
      statusPayload = await this.connector!.callTool("sources_status", { id: sourceId });
    } catch {
      throw new ControlActionError(503, "source_precheck_unavailable", "소스 상태를 확인할 수 없습니다.");
    }
    const status = record(statusPayload);
    if (status.id !== sourceId || status.archived === true) {
      throw new ControlActionError(409, "source_unavailable", "이 소스는 현재 관리할 수 없습니다.");
    }
    const listedRemoteUrl = typeof listed.remote_url === "string" && listed.remote_url.trim()
      ? listed.remote_url.trim()
      : null;
    const statusRemoteUrl = typeof status.remote_url === "string" && status.remote_url.trim()
      ? status.remote_url.trim()
      : null;
    if (listedRemoteUrl !== statusRemoteUrl) {
      throw new ControlActionError(409, "source_state_changed", "소스 설정이 확인 중 변경되었습니다.");
    }
    return {
      id: sourceId,
      remoteUrl: statusRemoteUrl,
      cloneState: typeof status.clone_state === "string" ? status.clone_state : "unknown",
      localPathPresent: typeof status.local_path === "string" && status.local_path.length > 0,
    };
  }

  private async verifyMutation(plan: MutationPlan, mutation: unknown): Promise<ControlActionJob | null> {
    let jobId = plan.kind === "existing-job" ? plan.jobId : positiveInteger(record(mutation).id);
    if (!jobId) return null;

    let rawJob: unknown;
    try {
      rawJob = await this.connector!.callTool("get_job", { id: jobId });
    } catch {
      return null;
    }
    const job = record(rawJob);
    const normalized = normalizeJob(job, this.allowedSourceIds);
    if (
      !normalized
      || normalized.id !== jobId
      || normalized.name !== plan.expectedName
      || normalized.sourceId !== plan.sourceId
      || job.queue !== plan.expectedQueue
      || job.priority !== plan.expectedPriority
      || job.max_attempts !== plan.expectedMaxAttempts
      || job.timeout_ms !== plan.expectedTimeoutMs
      || !fixedValueEqual(job.data, plan.expectedData)
    ) return null;

    if (plan.tool === "cancel_job" && normalized.status !== "cancelled") return null;
    if (
      plan.tool === "retry_job"
      && (normalized.status === "failed" || normalized.status === "dead" || normalized.status === "cancelled")
    ) return null;
    return normalized;
  }

  private async withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.ledgerTail;
    let release!: () => void;
    this.ledgerTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async loadLedger(): Promise<LedgerDocument> {
    const now = this.now();
    if (!this.config.actionLedgerPath) {
      this.memoryLedger.records = this.memoryLedger.records.filter(
        (entry) => Date.parse(entry.expiresAt) > now,
      );
      return this.memoryLedger;
    }
    let contents: string;
    try {
      const stat = await lstat(this.config.actionLedgerPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("ledger target is not a regular file");
      }
      contents = await readFile(this.config.actionLedgerPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: LEDGER_VERSION, records: [] };
      }
      if (error instanceof ControlActionError) throw error;
      throw new ControlActionError(503, "ledger_unavailable", "관리 작업 원장을 읽을 수 없습니다.");
    }
    try {
      const parsed = JSON.parse(contents) as unknown;
      const document = record(parsed);
      if (
        document.version !== LEDGER_VERSION
        || !Array.isArray(document.records)
        || !document.records.every(validLedgerRecord)
      ) throw new Error("invalid ledger shape");
      return {
        version: LEDGER_VERSION,
        records: document.records.filter((entry) => Date.parse(entry.expiresAt) > now),
      };
    } catch {
      throw new ControlActionError(503, "ledger_corrupt", "관리 작업 원장의 무결성을 확인할 수 없습니다.");
    }
  }

  private async saveLedger(ledger: LedgerDocument): Promise<void> {
    if (!this.config.actionLedgerPath) {
      this.memoryLedger = ledger;
      return;
    }
    const path = this.config.actionLedgerPath;
    const directory = dirname(path);
    const temporaryPath = `${directory}/.${basename(path)}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(ledger)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
      try {
        const directoryHandle = await open(directory, "r");
        await directoryHandle.sync();
        await directoryHandle.close();
      } catch {
        // Directory fsync is unavailable on some platforms; the file itself
        // has already been atomically replaced and fsynced.
      }
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw new ControlActionError(503, "ledger_write_failed", "관리 작업 원장을 안전하게 저장할 수 없습니다.");
    }
  }
}
