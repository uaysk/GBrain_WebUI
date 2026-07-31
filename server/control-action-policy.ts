import { createHash } from "node:crypto";
import type { ControlActionRequest } from "../shared/contracts";

type JsonRecord = Record<string, unknown>;

export const SOURCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ACTOR_HASH_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

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

function expectedConfirmation(request: ControlActionRequest): string {
  switch (request.action) {
    case "quick-dream": return `RUN ${request.sourceId}`;
    case "source-sync": return `SYNC ${request.sourceId}`;
    case "embedding-refresh": return `EMBED ${request.sourceId}`;
    case "job-retry": return `RETRY #${request.jobId}`;
    case "job-cancel": return `CANCEL #${request.jobId}`;
  }
}

export function validateControlActionRequest(value: unknown): ControlActionRequest {
  const body = record(value);
  const action = body.action;
  if (action === "quick-dream" || action === "source-sync" || action === "embedding-refresh") {
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

export function parseControlActionRequest(raw: string): ControlActionRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ControlActionError(400, "invalid_json", "올바른 JSON 요청이 필요합니다.");
  }
  return validateControlActionRequest(value);
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

export function controlActionRequestTarget(request: ControlActionRequest): string {
  return "sourceId" in request ? `source:${request.sourceId}` : `job:${request.jobId}`;
}

export function controlActionRequestHash(request: ControlActionRequest): string {
  return createHash("sha256").update(canonicalRequest(request)).digest("hex");
}

export function safeControlActorHash(value: string | undefined): string | undefined {
  return value && ACTOR_HASH_PATTERN.test(value) ? value : undefined;
}
