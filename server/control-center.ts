import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ControlCenterResponse,
  ControlJob,
  ControlJobProgress,
  ControlJobStatus,
  ControlMetric,
  ControlPhase,
  ControlPhaseStatus,
  ControlRecentJobCounts,
  ControlRun,
  ControlSourceStatus,
  ControlTone,
} from "../src/types";
import type { Config } from "./config";

type JsonRecord = Record<string, unknown>;

export interface ControlReadResult {
  status: unknown | null;
  recentJobs: unknown[] | null;
  fullRuns: unknown[] | null;
  globalRuns: unknown[] | null;
  partial: boolean;
}

export interface ControlReader {
  read(): Promise<ControlReadResult>;
}

const PHASE_LABELS: Record<string, string> = {
  lint: "문서 검사",
  backlinks: "백링크 검사",
  sync: "소스 동기화",
  synthesize: "대화 합성",
  extract: "관계 추출",
  extract_facts: "Fact 색인",
  extract_atoms: "Atom 추출",
  resolve_symbol_edges: "코드 관계 해석",
  patterns: "패턴 탐색",
  synthesize_concepts: "Concept 합성",
  recompute_emotional_weight: "중요도 재계산",
  consolidate: "Fact 통합",
  propose_takes: "Take 제안",
  grade_takes: "Take 평가",
  calibration_profile: "판단 보정",
  conversation_facts_backfill: "대화 Fact 보강",
  enrich_thin: "얇은 페이지 보강",
  skillopt: "Skill 최적화",
  embed: "Embedding 갱신",
  orphans: "고립 페이지 검사",
  "schema-suggest": "Schema 제안",
  purge: "만료 항목 정리",
};

const JOB_LABELS: Record<string, string> = {
  "autopilot-cycle": "Dream · Source cycle",
  "autopilot-global-maintenance": "Dream · Global maintenance",
  sync: "소스 동기화",
  embed: "Embedding",
  "embed-backfill": "Embedding 보강",
  lint: "문서 검사",
  extract: "관계 추출",
  backlinks: "백링크 검사",
  import: "가져오기",
};

const METRIC_LABELS: Record<string, { label: string; tone?: ControlTone }> = {
  lint_fixes: { label: "수정된 검사 항목", tone: "good" },
  pages_synced: { label: "동기화 페이지", tone: "good" },
  orphans_found: { label: "고립 페이지", tone: "warning" },
  edges_resolved: { label: "해석된 관계", tone: "good" },
  pages_embedded: { label: "Embedding 페이지", tone: "good" },
  backlinks_added: { label: "추가된 백링크", tone: "good" },
  edges_ambiguous: { label: "모호한 관계", tone: "warning" },
  pages_extracted: { label: "추출된 페이지", tone: "good" },
  patterns_written: { label: "생성된 패턴", tone: "good" },
  facts_consolidated: { label: "통합된 Facts", tone: "good" },
  purged_pages_count: { label: "정리된 페이지", tone: "warning" },
  purged_sources_count: { label: "정리된 Sources", tone: "warning" },
  synth_pages_written: { label: "합성 페이지", tone: "good" },
  transcripts_processed: { label: "처리된 대화", tone: "good" },
  consolidate_takes_written: { label: "생성된 Takes", tone: "good" },
  pages_emotional_weight_recomputed: { label: "중요도 갱신 페이지", tone: "good" },
  phantom_redirected: { label: "해결된 가상 링크", tone: "good" },
  phantoms_redirected: { label: "해결된 가상 링크", tone: "good" },
  phantoms_ambiguous: { label: "모호한 가상 링크", tone: "warning" },
  phantom_ambiguous: { label: "모호한 가상 링크", tone: "warning" },
  fixed: { label: "수정", tone: "good" },
  fixes: { label: "수정", tone: "good" },
  issues: { label: "남은 문제", tone: "warning" },
  pages_scanned: { label: "검사 페이지" },
  gaps: { label: "누락" },
  added: { label: "추가", tone: "good" },
  deleted: { label: "삭제", tone: "warning" },
  renamed: { label: "이름 변경" },
  modified: { label: "수정", tone: "good" },
  failedFiles: { label: "실패 파일", tone: "danger" },
  chunksCreated: { label: "생성 Chunk", tone: "good" },
  chunksProcessed: { label: "처리 Chunk", tone: "good" },
  pagesAffected: { label: "영향받은 페이지", tone: "good" },
  pagesProcessed: { label: "처리 페이지", tone: "good" },
  spentUsd: { label: "처리 비용 (USD)" },
  pages_written: { label: "작성 페이지", tone: "good" },
  linksCreated: { label: "생성 관계", tone: "good" },
  timelineCreated: { label: "Timeline 항목", tone: "good" },
  legacyRowsPending: { label: "Migration 대기", tone: "warning" },
  pages_recomputed: { label: "재계산 페이지", tone: "good" },
  takes_written: { label: "생성 Takes", tone: "good" },
  buckets_processed: { label: "처리 그룹" },
  buckets_skipped: { label: "건너뛴 그룹", tone: "warning" },
  cache_hits: { label: "Cache 적중", tone: "good" },
  cache_misses: { label: "Cache 미스" },
  proposals_inserted: { label: "신규 제안", tone: "good" },
  suggestions_emitted: { label: "Schema 제안", tone: "good" },
  embedded: { label: "Embedding 완료", tone: "good" },
  deferred: { label: "처리 보류", tone: "warning" },
  extracted: { label: "추출 완료", tone: "good" },
  remaining: { label: "남은 항목", tone: "warning" },
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeMachineName(value: unknown, fallback: string): string {
  const candidate = text(value).trim();
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/i.test(candidate) ? candidate : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function nullableIso(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scrubText(value: unknown, fallback = ""): string {
  return text(value, fallback)
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted-database-url>")
    .replace(/\b(api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*["']?[^\s"',}]+/gi, "$1=<redacted>")
    .replace(/(^|[\s"'(<[{])\/(?!\/)[^\s"',)}\]]+/g, "$1<local-path>")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "<local-path>")
    .replace(/\\\\[^\\\s]+\\[^\s]+/g, "<local-path>")
    .slice(0, 600);
}

function durationBetween(startedAt: string | null, finishedAt: string | null): number {
  if (!startedAt) return 0;
  return Math.max(0, (finishedAt ? new Date(finishedAt).getTime() : Date.now()) - new Date(startedAt).getTime());
}

function phaseStatus(value: unknown): ControlPhaseStatus {
  switch (text(value).toLowerCase()) {
    case "ok":
    case "clean":
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
    case "synced":
    case "up_to_date":
    case "up-to-date":
    case "no_changes":
    case "dry_run":
      return "ok";
    case "warn":
    case "warning":
    case "partial":
    case "blocked_by_failures":
    case "budget_exhausted":
    case "deferred":
      return "warn";
    case "fail":
    case "failed":
    case "dead":
    case "error":
      return "fail";
    case "skipped":
      return "skipped";
    case "active":
    case "running":
      return "running";
    default:
      return "unknown";
  }
}

function jobStatus(value: unknown): ControlJobStatus {
  switch (text(value).toLowerCase()) {
    case "waiting":
    case "waiting-children":
    case "paused":
    case "active":
    case "completed":
    case "failed":
    case "delayed":
    case "dead":
    case "cancelled":
      return text(value).toLowerCase() as ControlJobStatus;
    default:
      return "unknown";
  }
}

function toneForMetric(key: string, value: number): ControlTone {
  if (value === 0) return "neutral";
  return METRIC_LABELS[key]?.tone ?? "neutral";
}

function metricsFrom(value: unknown, includeZero = false): ControlMetric[] {
  const source = record(value);
  const metrics: ControlMetric[] = [];
  for (const [key, meta] of Object.entries(METRIC_LABELS)) {
    if (!(key in source)) continue;
    const metricValue = number(source[key], Number.NaN);
    if (!Number.isFinite(metricValue) || (!includeZero && metricValue === 0)) continue;
    metrics.push({ key, label: meta.label, value: metricValue, tone: toneForMetric(key, metricValue) });
  }
  return metrics;
}

function warningTexts(details: JsonRecord, error: JsonRecord): string[] {
  const values = [
    ...list(details.warnings).map((value) => scrubText(value)),
    scrubText(error.message),
    scrubText(error.hint),
  ].filter(Boolean);
  if (text(details.reason)) values.push(`건너뜀: ${scrubText(details.reason)}`);
  return [...new Set(values)].slice(0, 8);
}

export function normalizeControlPhase(value: unknown): ControlPhase {
  const source = record(value);
  const details = record(source.details);
  const error = record(source.error);
  const name = safeMachineName(source.phase, "unknown");
  return {
    name,
    label: PHASE_LABELS[name] ?? name.replaceAll("_", " "),
    status: phaseStatus(source.status),
    durationMs: Math.max(0, number(source.duration_ms)),
    summary: scrubText(source.summary, "단계 결과가 제공되지 않았습니다."),
    metrics: metricsFrom(details),
    warnings: warningTexts(details, error),
  };
}

function sourceIdFromJob(value: JsonRecord): string | null {
  const data = record(value.data);
  const raw = text(data.source_id) || text(data.sourceId);
  return raw ? safeMachineName(raw, "unknown") : null;
}

function reportFromJob(value: JsonRecord): JsonRecord {
  const result = record(value.result);
  const nested = record(result.report);
  return Object.keys(nested).length ? nested : result;
}

export function normalizeControlRun(value: unknown): ControlRun {
  const source = record(value);
  const report = reportFromJob(source);
  const phases = list(report.phases).map(normalizeControlPhase);
  const startedAt = nullableIso(source.started_at ?? report.started_at ?? report.timestamp);
  const finishedAt = nullableIso(source.finished_at ?? report.finished_at);
  const jobState = jobStatus(source.status);
  const result = record(source.result);
  const reportState = phaseStatus(result.status ?? report.status ?? (jobState === "completed" ? "ok" : jobState));
  const warnings = phases.flatMap((phase) => phase.warnings.map((warning) => `${phase.label}: ${warning}`)).slice(0, 12);
  const name = safeMachineName(source.name, "unknown");
  return {
    id: Number.isInteger(number(source.id, Number.NaN)) ? number(source.id) : null,
    name,
    label: JOB_LABELS[name] ?? name.replaceAll("-", " "),
    jobStatus: jobState,
    reportStatus: reportState,
    sourceId: sourceIdFromJob(source),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, number(report.duration_ms, durationBetween(startedAt, finishedAt))),
    partial: boolean(result.partial) || boolean(source.partial) || reportState === "warn",
    phases,
    impacts: metricsFrom(Object.keys(record(report.totals)).length ? report.totals : report),
    warnings,
  };
}

function normalizeSnapshotRun(value: unknown): ControlRun | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  const finishedAt = nullableIso(source.finished_at);
  const name = safeMachineName(source.name, "unknown");
  const rawSourceId = text(source.source_id) || text(source.sourceId);
  const sourceId = rawSourceId ? safeMachineName(rawSourceId, "unknown") : null;
  return {
    id: null,
    name,
    label: JOB_LABELS[name] ?? name.replaceAll("-", " "),
    jobStatus: jobStatus(source.status),
    reportStatus: "unknown",
    sourceId,
    startedAt: null,
    finishedAt,
    durationMs: Math.max(0, number(source.duration_ms)),
    partial: false,
    phases: [],
    impacts: metricsFrom(source.totals),
    warnings: [],
  };
}

export function normalizeControlJob(value: unknown): ControlJob {
  const source = record(value);
  const startedAt = nullableIso(source.started_at);
  const finishedAt = nullableIso(source.finished_at);
  const name = safeMachineName(source.name, "unknown");
  const normalizedStatus = jobStatus(source.status);
  const error = scrubText(source.error_text) || scrubText(record(source.error).message) || null;
  const hasReport = Object.keys(reportFromJob(source)).length > 0;
  return {
    id: Math.max(0, number(source.id)),
    parentId: number(source.parent_job_id, 0) > 0 ? number(source.parent_job_id) : null,
    name,
    label: JOB_LABELS[name] ?? name.replaceAll("-", " "),
    queue: safeMachineName(source.queue, "default"),
    status: normalizedStatus,
    sourceId: sourceIdFromJob(source),
    createdAt: nullableIso(source.created_at),
    startedAt,
    finishedAt,
    durationMs: durationBetween(startedAt, finishedAt),
    attemptsMade: Math.max(0, number(source.attempts_made ?? source.attempts_started)),
    maxAttempts: Math.max(0, number(source.max_attempts)),
    error,
    progress: normalizeControlProgress(source.progress),
    run: hasReport ? normalizeControlRun(source) : null,
  };
}

export function normalizeControlProgress(value: unknown): ControlJobProgress | null {
  if (typeof value === "number") {
    const percent = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
    return { phase: null, message: null, completed: null, total: null, percent };
  }
  if (typeof value === "string") {
    const message = scrubText(value);
    return message ? { phase: null, message, completed: null, total: null, percent: null } : null;
  }
  const source = record(value);
  if (!Object.keys(source).length) return null;
  const rawPhase = source.phase ?? source.step ?? source.stage;
  const phase = rawPhase ? safeMachineName(rawPhase, "unknown") : null;
  const message = scrubText(source.message ?? source.summary) || null;
  const completedValue = number(source.completed ?? source.done ?? source.current, Number.NaN);
  const totalValue = number(source.total, Number.NaN);
  const completed = Number.isFinite(completedValue) ? Math.max(0, completedValue) : null;
  const total = Number.isFinite(totalValue) ? Math.max(0, totalValue) : null;
  const explicitPercent = number(source.percent ?? source.percentage, Number.NaN);
  const percent = Number.isFinite(explicitPercent)
    ? Math.max(0, Math.min(100, explicitPercent <= 1 ? explicitPercent * 100 : explicitPercent))
    : completed !== null && total !== null && total > 0
      ? Math.max(0, Math.min(100, (completed / total) * 100))
      : null;
  return phase || message || completed !== null || total !== null || percent !== null
    ? { phase, message, completed, total, percent }
    : null;
}

export function normalizeControlSource(value: unknown): ControlSourceStatus {
  const source = record(value);
  const stale = text(source.staleness_class).toLowerCase();
  const id = safeMachineName(source.source_id, "unknown");
  return {
    id,
    name: scrubText(source.name, id),
    syncEnabled: source.sync_enabled !== false,
    lastSyncAt: nullableIso(source.last_sync_at),
    stalenessHours: Math.max(0, number(source.staleness_hours)),
    stalenessClass: stale === "fresh" || stale === "aging" || stale === "stale" ? stale : "unknown",
    pages: Math.max(0, number(source.pages)),
    chunksTotal: Math.max(0, number(source.chunks_total)),
    chunksUnembedded: Math.max(0, number(source.chunks_unembedded)),
    embeddingCoveragePct: Math.max(0, Math.min(100, number(source.embedding_coverage_pct))),
    backfillQueued: Math.max(0, number(source.backfill_queued)),
    backfillActive: Math.max(0, number(source.backfill_active)),
  };
}

function recentCounts(jobs: ControlJob[]): ControlRecentJobCounts {
  const counts: ControlRecentJobCounts = {
    sampleSize: jobs.length,
    waiting: 0,
    waitingChildren: 0,
    paused: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    dead: 0,
    cancelled: 0,
    unknown: 0,
  };
  for (const job of jobs) {
    if (job.status === "waiting-children") counts.waitingChildren += 1;
    else counts[job.status] += 1;
  }
  return counts;
}

function sameRun(run: ControlRun, snapshot: ControlRun | null): boolean {
  if (!snapshot || run.name !== snapshot.name) return false;
  if (!snapshot.finishedAt) return true;
  return run.finishedAt === snapshot.finishedAt;
}

export function normalizeControlCenter(
  statusValue: unknown,
  jobsValue: unknown[],
  allowedSourceIds?: readonly string[],
  runJobsValue: unknown[] = [],
): ControlCenterResponse {
  const status = record(statusValue);
  const sync = record(status.sync);
  const cycle = record(status.cycle);
  const allowedSources = allowedSourceIds ? new Set(allowedSourceIds) : null;
  const sourceStatuses = list(sync.sources).map(normalizeControlSource);
  const allSourcesVisible = !allowedSources || (
    sourceStatuses.length > 0
    && sourceStatuses.every((source) => allowedSources.has(source.id))
  );
  const jobIsVisible = (job: ControlJob) => job.sourceId
    ? !allowedSources || allowedSources.has(job.sourceId)
    : allSourcesVisible;
  const normalizeJobs = (values: unknown[]) => values
    .map(normalizeControlJob)
    .filter((job) => job.id > 0 && jobIsVisible(job))
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime || right.id - left.id;
    });
  const recentJobs = normalizeJobs(jobsValue);
  const allJobsById = new Map<number, ControlJob>();
  for (const job of normalizeJobs([...jobsValue, ...runJobsValue])) allJobsById.set(job.id, job);
  const allJobs = [...allJobsById.values()].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime || right.id - left.id;
  });
  const snapshotFull = normalizeSnapshotRun(cycle.last_full);
  const snapshotTargeted = normalizeSnapshotRun(cycle.last_targeted);
  const runJobs = allJobs.map((job) => job.run).filter((run): run is ControlRun => run !== null);
  const matchedFullRun = snapshotFull
    ? runJobs.find((run) => sameRun(run, snapshotFull))
    : runJobs.find((run) => run.name === "autopilot-cycle");
  const snapshotFullIsVisible = !allowedSources || (
    snapshotFull !== null
    && snapshotFull.sourceId !== null
    && allowedSources.has(snapshotFull.sourceId)
  );
  const latestFullRun = matchedFullRun ?? (snapshotFullIsVisible ? snapshotFull : null);
  const matchedTargetedRun = snapshotTargeted
    ? runJobs.find((run) => sameRun(run, snapshotTargeted))
    : runJobs.find((run) => run.name === "autopilot-global-maintenance");
  const snapshotTargetedIsVisible = !allowedSources || (
    snapshotTargeted !== null
    && (snapshotTargeted.sourceId !== null
      ? allowedSources.has(snapshotTargeted.sourceId)
      : allSourcesVisible)
  );
  const latestTargetedRun = matchedTargetedRun ?? (snapshotTargetedIsVisible ? snapshotTargeted : null);
  const jobs = recentJobs.slice(0, 30);
  return {
    generatedAt: new Date().toISOString(),
    availability: { configured: true, connected: true, message: null },
    management: { enabled: false, confirmationRequired: true },
    version: scrubText(status.version) || null,
    sources: sourceStatuses
      .filter((source) => !allowedSources || allowedSources.has(source.id)),
    latestFullRun,
    latestTargetedRun,
    recentJobCounts: recentCounts(jobs),
    jobs,
  };
}

function unavailableResponse(configured: boolean, message: string): ControlCenterResponse {
  return {
    generatedAt: new Date().toISOString(),
    availability: { configured, connected: false, message },
    management: { enabled: false, confirmationRequired: true },
    version: null,
    sources: [],
    latestFullRun: null,
    latestTargetedRun: null,
    recentJobCounts: recentCounts([]),
    jobs: [],
  };
}

export function decodeControlToolPayload(value: unknown): unknown {
  const result = record(value);
  if (result.isError === true) throw new Error("GBrain MCP tool returned an error");
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const content = list(result.content);
  const block = content.map(record).find((item) => item.type === "text" && typeof item.text === "string");
  if (!block) throw new Error("GBrain MCP tool returned no structured text");
  try {
    return JSON.parse(text(block.text));
  } catch {
    throw new Error("GBrain MCP tool returned invalid JSON");
  }
}

type DecodedToolResult = { ok: true; value: unknown } | { ok: false; value: null };

function decodeSettledToolResult(result: PromiseSettledResult<unknown>, shape: "object" | "array"): DecodedToolResult {
  if (result.status === "rejected") return { ok: false, value: null };
  try {
    const value = decodeControlToolPayload(result.value);
    const valid = shape === "array"
      ? Array.isArray(value)
      : value !== null && typeof value === "object" && !Array.isArray(value);
    return valid ? { ok: true, value } : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

class McpControlReader implements ControlReader {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  async read(): Promise<ControlReadResult> {
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    const client = new Client({ name: "gbrain-webui-control-center", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: this.timeoutMs });
      const [statusResult, jobsResult, fullRunsResult, globalRunsResult] = await Promise.allSettled([
        client.callTool({ name: "get_status_snapshot", arguments: {} }, undefined, { timeout: this.timeoutMs }),
        client.callTool({ name: "list_jobs", arguments: { limit: 30 } }, undefined, { timeout: this.timeoutMs }),
        client.callTool({ name: "list_jobs", arguments: { name: "autopilot-cycle", limit: 5 } }, undefined, { timeout: this.timeoutMs }),
        client.callTool({ name: "list_jobs", arguments: { name: "autopilot-global-maintenance", limit: 5 } }, undefined, { timeout: this.timeoutMs }),
      ]);
      const statusRead = decodeSettledToolResult(statusResult, "object");
      const jobsRead = decodeSettledToolResult(jobsResult, "array");
      const fullRunsRead = decodeSettledToolResult(fullRunsResult, "array");
      const globalRunsRead = decodeSettledToolResult(globalRunsResult, "array");
      const reads = [statusRead, jobsRead, fullRunsRead, globalRunsRead];
      if (!reads.some((result) => result.ok)) throw new Error("All GBrain MCP control requests failed");
      return {
        status: statusRead.ok ? statusRead.value : null,
        recentJobs: jobsRead.ok ? jobsRead.value as unknown[] : null,
        fullRuns: fullRunsRead.ok ? fullRunsRead.value as unknown[] : null,
        globalRuns: globalRunsRead.ok ? globalRunsRead.value as unknown[] : null,
        partial: reads.some((result) => !result.ok),
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

function safeServerError(error: unknown): string {
  return scrubText(error instanceof Error ? error.message : "Unknown error");
}

export class ControlCenterService {
  private cached: { at: number; value: ControlCenterResponse } | null = null;
  private inFlight: Promise<ControlCenterResponse> | null = null;
  private lastForcedAt = 0;
  private readonly reader: ControlReader | null;

  constructor(
    private readonly config: Config["controlCenter"],
    private readonly allowedSourceIds: readonly string[],
    reader?: ControlReader,
  ) {
    this.reader = reader ?? (config.mcpUrl && config.mcpToken
      ? new McpControlReader(config.mcpUrl, config.mcpToken, config.requestTimeoutMs)
      : null);
  }

  invalidate(): void {
    this.cached = null;
  }

  async getOverview(force = false): Promise<ControlCenterResponse> {
    if (!this.reader) {
      return unavailableResponse(false, "GBrain Control MCP 연결이 설정되지 않았습니다.");
    }
    if (this.inFlight) return this.inFlight;
    if (!force && this.cached && Date.now() - this.cached.at < this.config.cacheMs) return this.cached.value;
    if (force && Date.now() - this.lastForcedAt < 5_000) {
      return this.cached?.value ?? unavailableResponse(true, "갱신 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.");
    }
    if (force) this.lastForcedAt = Date.now();
    this.inFlight = this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async load(): Promise<ControlCenterResponse> {
    try {
      const result = await this.reader!.read();
      const normalized = normalizeControlCenter(
        result.status,
        result.recentJobs ?? [],
        this.allowedSourceIds,
        [...(result.fullRuns ?? []), ...(result.globalRuns ?? [])],
      );
      if (this.cached) {
        if (result.status === null) {
          normalized.version = this.cached.value.version;
          normalized.sources = this.cached.value.sources;
        }
        if (result.recentJobs === null) {
          normalized.jobs = this.cached.value.jobs;
          normalized.recentJobCounts = this.cached.value.recentJobCounts;
        }
        if (!normalized.latestFullRun) normalized.latestFullRun = this.cached.value.latestFullRun;
        if (!normalized.latestTargetedRun) normalized.latestTargetedRun = this.cached.value.latestTargetedRun;
      }
      if (result.partial) normalized.availability.message = "일부 GBrain 운영 데이터를 불러오지 못했습니다.";
      normalized.management.enabled = this.config.mutationsEnabled && normalized.availability.connected && !result.partial;
      this.cached = { at: Date.now(), value: normalized };
      return normalized;
    } catch (error) {
      console.error("Control Center refresh failed:", safeServerError(error));
      if (this.cached) {
        return {
          ...this.cached.value,
          availability: {
            configured: true,
            connected: false,
            message: "GBrain Control MCP에 연결할 수 없어 마지막 정상 상태를 표시합니다.",
          },
          management: { enabled: false, confirmationRequired: true },
        };
      }
      return unavailableResponse(true, "GBrain Control MCP에 연결할 수 없습니다.");
    }
  }
}
