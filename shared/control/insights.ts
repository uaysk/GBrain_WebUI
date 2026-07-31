import type {
  ControlActionName,
  ControlCenterResponse,
  ControlJob,
  ControlJobStatus,
  ControlSourceStatus,
  ControlTone,
} from "../contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_STALE_HOURS = 24;
const DEFAULT_LOW_EMBEDDING_PCT = 90;
const DEFAULT_LONG_WAITING_MS = 15 * 60 * 1_000;
const OPEN_JOB_STATUSES = new Set<ControlJobStatus>([
  "waiting",
  "waiting-children",
  "paused",
  "active",
  "delayed",
]);
const WAITING_JOB_STATUSES = new Set<ControlJobStatus>([
  "waiting",
  "waiting-children",
  "paused",
  "delayed",
]);

const ACTION_LABELS: Record<ControlActionName, string> = {
  "quick-dream": "빠른 Dream",
  "source-sync": "소스 동기화",
  "embedding-refresh": "Embedding 갱신",
  "job-retry": "작업 재시도",
  "job-cancel": "작업 취소",
};

export type ControlInboxKind =
  | "failed-job"
  | "stale-source"
  | "low-embedding"
  | "long-waiting"
  | "pending-verification";

export type ControlInboxSeverity = "critical" | "high" | "medium";

export interface ControlPendingVerification {
  actionId: string;
  action: ControlActionName;
  createdAt: string;
  sourceId?: string | null;
  jobId?: number | null;
}

export interface ControlInboxOptions {
  /**
   * 기준 시각입니다. 생략하면 snapshot.generatedAt을 사용합니다.
   * 테스트와 서버 응답이 동일하도록 Date.now()는 사용하지 않습니다.
   */
  now?: string | Date;
  staleAfterHours?: number;
  lowEmbeddingPct?: number;
  longWaitingMs?: number;
  pendingVerifications?: readonly ControlPendingVerification[];
  limit?: number;
}

export interface ControlInboxItem {
  id: string;
  kind: ControlInboxKind;
  severity: ControlInboxSeverity;
  priority: number;
  title: string;
  message: string;
  sourceId: string | null;
  jobId: number | null;
  action: ControlActionName | null;
  occurredAt: string | null;
  ageMs: number | null;
}

export interface ControlHistorySourcePoint {
  id: string;
  pages: number;
  chunks: number;
  unembeddedChunks: number;
  embeddingCoveragePct: number;
  stalenessHours: number;
}

export interface ControlHistoryJobPoint {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  dead: number;
  cancelled: number;
  successRatePct: number | null;
  averageDurationMs: number | null;
}

export interface ControlHistoryTotalsPoint {
  pages: number;
  chunks: number;
  unembeddedChunks: number;
  embeddingCoveragePct: number | null;
  staleSources: number;
}

export interface ControlHistoryPoint {
  at: string;
  totals: ControlHistoryTotalsPoint;
  jobs: ControlHistoryJobPoint;
  sources: ControlHistorySourcePoint[];
}

export interface ControlHistoryAccumulatorOptions {
  capturedAt?: string | Date;
  maxAgeDays?: number;
  maxPoints?: number;
}

export interface ControlTrendValue {
  first: number;
  latest: number;
  delta: number;
  minimum: number;
  maximum: number;
  average: number;
}

export interface ControlSourceTrend {
  sourceId: string;
  samples: number;
  pages: ControlTrendValue;
  chunks: ControlTrendValue;
  unembeddedChunks: ControlTrendValue;
  embeddingCoveragePct: ControlTrendValue;
  stalenessHours: ControlTrendValue;
}

export interface ControlTrendWindow {
  days: 7 | 30;
  from: string;
  to: string;
  samples: number;
  firstAt: string | null;
  latestAt: string | null;
  totals: {
    pages: ControlTrendValue | null;
    chunks: ControlTrendValue | null;
    unembeddedChunks: ControlTrendValue | null;
    embeddingCoveragePct: ControlTrendValue | null;
    staleSources: ControlTrendValue | null;
  };
  jobs: {
    queued: ControlTrendValue | null;
    active: ControlTrendValue | null;
    completed: ControlTrendValue | null;
    failed: ControlTrendValue | null;
    dead: ControlTrendValue | null;
    cancelled: ControlTrendValue | null;
    successRatePct: ControlTrendValue | null;
    averageDurationMs: ControlTrendValue | null;
  };
  sources: ControlSourceTrend[];
}

export interface ControlHistorySummary {
  generatedAt: string;
  sevenDays: ControlTrendWindow;
  thirtyDays: ControlTrendWindow;
}

export type ControlActionPreviewTarget =
  | {
    action: "quick-dream" | "source-sync" | "embedding-refresh";
    sourceId: string;
  }
  | {
    action: "job-retry" | "job-cancel";
    jobId: number;
  };

export interface ControlPreviewWorkload {
  pages: number | null;
  chunks: number | null;
  qualifier: "upper-bound" | "minimum" | "current-size" | "not-applicable";
  label: string;
}

export interface ControlPreviewConflict {
  jobId: number;
  label: string;
  status: ControlJobStatus;
}

export interface ControlActionPreview {
  action: ControlActionName;
  actionLabel: string;
  targetLabel: string;
  sourceId: string | null;
  jobId: number | null;
  isEstimate: true;
  estimateNotice: string;
  workload: ControlPreviewWorkload;
  duration: {
    minMs: number;
    maxMs: number;
    label: string;
    basis: "recent-jobs" | "default-range";
    sampleSize: number;
  };
  conflicts: ControlPreviewConflict[];
  followUps: string[];
  warnings: string[];
}

export interface ControlMetricDiff {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  unit: "count" | "percent" | "hours";
  direction: "up" | "down" | "same";
  tone: ControlTone;
  lowerIsBetter: boolean;
}

export interface ControlMetricDiffResult {
  scope: "source" | "all-sources";
  sourceId: string | null;
  beforeAt: string;
  afterAt: string;
  metrics: ControlMetricDiff[];
  warnings: string[];
}

function finiteAtLeast(value: number | undefined, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value as number) : fallback;
}

function isoTime(value: string | Date): { iso: string; ms: number } | null {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? { iso: date.toISOString(), ms } : null;
}

function requiredIsoTime(value: string | Date, field: string): { iso: string; ms: number } {
  const parsed = isoTime(value);
  if (!parsed) throw new RangeError(`${field} must be a valid date`);
  return parsed;
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeAgeMs(at: string | null | undefined, nowMs: number): number | null {
  if (!at) return null;
  const parsed = isoTime(at);
  if (!parsed) return null;
  return Math.max(0, nowMs - parsed.ms);
}

function jobAnchor(job: ControlJob): string | null {
  return job.startedAt ?? job.createdAt;
}

function inboxSort(left: ControlInboxItem, right: ControlInboxItem): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const leftTime = left.occurredAt ? isoTime(left.occurredAt)?.ms ?? 0 : 0;
  const rightTime = right.occurredAt ? isoTime(right.occurredAt)?.ms ?? 0 : 0;
  return leftTime - rightTime || left.id.localeCompare(right.id);
}

/**
 * 정규화된 Control Center snapshot으로 운영자가 먼저 볼 항목을 계산합니다.
 * job.error 등 자유 형식 문자열은 복사하지 않습니다.
 */
export function buildControlInbox(
  snapshot: ControlCenterResponse,
  options: ControlInboxOptions = {},
): ControlInboxItem[] {
  const now = requiredIsoTime(options.now ?? snapshot.generatedAt, "now");
  const staleAfterHours = finiteAtLeast(options.staleAfterHours, DEFAULT_STALE_HOURS, 0);
  const lowEmbeddingPct = clamp(
    finiteAtLeast(options.lowEmbeddingPct, DEFAULT_LOW_EMBEDDING_PCT, 0),
    0,
    100,
  );
  const longWaitingMs = finiteAtLeast(options.longWaitingMs, DEFAULT_LONG_WAITING_MS, 0);
  const limit = Math.floor(finiteAtLeast(options.limit, 50, 0));
  const items: ControlInboxItem[] = [];

  for (const job of snapshot.jobs) {
    if (job.status === "failed" || job.status === "dead") {
      const dead = job.status === "dead";
      items.push({
        id: `job:${job.id}:${job.status}`,
        kind: "failed-job",
        severity: "critical",
        priority: dead ? 100 : 95,
        title: dead ? "재시도 한도에 도달한 작업" : "실패한 작업",
        message: `${job.label} #${job.id} · 시도 ${job.attemptsMade}/${job.maxAttempts || "—"}`,
        sourceId: job.sourceId,
        jobId: job.id,
        action: job.name === "sync" || job.name === "embed" ? "job-retry" : null,
        occurredAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
        ageMs: safeAgeMs(job.finishedAt ?? job.startedAt ?? job.createdAt, now.ms),
      });
    }

    if (WAITING_JOB_STATUSES.has(job.status)) {
      const anchor = jobAnchor(job);
      const ageMs = safeAgeMs(anchor, now.ms);
      if (ageMs !== null && ageMs >= longWaitingMs) {
        items.push({
          id: `job:${job.id}:long-waiting`,
          kind: "long-waiting",
          severity: ageMs >= longWaitingMs * 4 ? "high" : "medium",
          priority: ageMs >= longWaitingMs * 4 ? 78 : 62,
          title: "오래 대기 중인 작업",
          message: `${job.label} #${job.id} · ${job.status} 상태가 오래 지속되고 있습니다.`,
          sourceId: job.sourceId,
          jobId: job.id,
          action: null,
          occurredAt: anchor,
          ageMs,
        });
      }
    }
  }

  for (const source of snapshot.sources) {
    if (source.stalenessClass === "stale" || source.stalenessHours >= staleAfterHours) {
      items.push({
        id: `source:${source.id}:stale`,
        kind: "stale-source",
        severity: source.stalenessHours >= staleAfterHours * 2 ? "high" : "medium",
        priority: source.stalenessHours >= staleAfterHours * 2 ? 84 : 72,
        title: "오래된 Source",
        message: `${source.name} · 마지막 동기화 후 ${rounded(source.stalenessHours, 1)}시간`,
        sourceId: source.id,
        jobId: null,
        action: source.syncEnabled ? "source-sync" : null,
        occurredAt: source.lastSyncAt,
        ageMs: safeAgeMs(source.lastSyncAt, now.ms),
      });
    }

    if (
      source.chunksTotal > 0
      && (source.embeddingCoveragePct < lowEmbeddingPct || source.chunksUnembedded > 0)
    ) {
      const severe = source.embeddingCoveragePct < Math.min(75, lowEmbeddingPct);
      items.push({
        id: `source:${source.id}:embedding`,
        kind: "low-embedding",
        severity: severe ? "high" : "medium",
        priority: severe ? 82 : 68,
        title: "Embedding 적용률 확인 필요",
        message: `${source.name} · ${rounded(source.embeddingCoveragePct, 1)}% 적용 · 미처리 ${source.chunksUnembedded} chunks`,
        sourceId: source.id,
        jobId: null,
        action: "embedding-refresh",
        occurredAt: snapshot.generatedAt,
        ageMs: 0,
      });
    }
  }

  for (const pending of options.pendingVerifications ?? []) {
    const created = isoTime(pending.createdAt);
    if (!created) continue;
    const ageMs = Math.max(0, now.ms - created.ms);
    const target = pending.jobId && pending.jobId > 0
      ? `Job #${pending.jobId}`
      : pending.sourceId
        ? `Source ${pending.sourceId}`
        : "대상";
    items.push({
      id: `action:${pending.actionId}`,
      kind: "pending-verification",
      severity: ageMs >= 10 * 60 * 1_000 ? "high" : "medium",
      priority: ageMs >= 10 * 60 * 1_000 ? 90 : 75,
      title: "실행 결과 확인 대기",
      message: `${ACTION_LABELS[pending.action]} · ${target} 반영 여부를 확인하고 있습니다.`,
      sourceId: pending.sourceId ?? null,
      jobId: pending.jobId && pending.jobId > 0 ? pending.jobId : null,
      action: pending.action,
      occurredAt: created.iso,
      ageMs,
    });
  }

  return items.sort(inboxSort).slice(0, limit);
}

function historySource(source: ControlSourceStatus): ControlHistorySourcePoint {
  return {
    id: source.id,
    pages: Math.max(0, source.pages),
    chunks: Math.max(0, source.chunksTotal),
    unembeddedChunks: Math.max(0, source.chunksUnembedded),
    embeddingCoveragePct: rounded(clamp(source.embeddingCoveragePct, 0, 100)),
    stalenessHours: rounded(Math.max(0, source.stalenessHours)),
  };
}

function aggregateHistorySources(sources: readonly ControlHistorySourcePoint[]): ControlHistoryTotalsPoint {
  const totals = sources.reduce((value, source) => ({
    pages: value.pages + source.pages,
    chunks: value.chunks + source.chunks,
    unembeddedChunks: value.unembeddedChunks + source.unembeddedChunks,
    staleSources: value.staleSources + (source.stalenessHours >= DEFAULT_STALE_HOURS ? 1 : 0),
  }), { pages: 0, chunks: 0, unembeddedChunks: 0, staleSources: 0 });
  return {
    ...totals,
    embeddingCoveragePct: totals.chunks > 0
      ? rounded(((totals.chunks - Math.min(totals.chunks, totals.unembeddedChunks)) / totals.chunks) * 100)
      : null,
  };
}

function terminalSuccessRate(snapshot: ControlCenterResponse): number | null {
  const counts = snapshot.recentJobCounts;
  const terminal = counts.completed + counts.failed + counts.dead + counts.cancelled;
  return terminal > 0 ? rounded((counts.completed / terminal) * 100) : null;
}

function averageCompletedDuration(snapshot: ControlCenterResponse): number | null {
  const durations = snapshot.jobs
    .filter((job) => job.status === "completed" && job.durationMs > 0)
    .map((job) => job.durationMs);
  return durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : null;
}

/** 현재 snapshot 하나를 저장 가능한 compact trend point로 변환합니다. */
export function createControlHistoryPoint(
  snapshot: ControlCenterResponse,
  capturedAt: string | Date = snapshot.generatedAt,
): ControlHistoryPoint {
  const at = requiredIsoTime(capturedAt, "capturedAt").iso;
  const sources = snapshot.sources
    .map(historySource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const counts = snapshot.recentJobCounts;
  return {
    at,
    totals: aggregateHistorySources(sources),
    jobs: {
      queued: counts.waiting + counts.waitingChildren + counts.paused + counts.delayed,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      dead: counts.dead,
      cancelled: counts.cancelled,
      successRatePct: terminalSuccessRate(snapshot),
      averageDurationMs: averageCompletedDuration(snapshot),
    },
    sources,
  };
}

/**
 * snapshot point를 immutable하게 누적합니다. 같은 시각의 point는 최신 값으로
 * 교체하며, 기준 시각보다 미래이거나 retention 밖인 point는 제거합니다.
 */
export function accumulateControlHistory(
  history: readonly ControlHistoryPoint[],
  snapshot: ControlCenterResponse,
  options: ControlHistoryAccumulatorOptions = {},
): ControlHistoryPoint[] {
  const point = createControlHistoryPoint(snapshot, options.capturedAt ?? snapshot.generatedAt);
  const pointTime = requiredIsoTime(point.at, "point.at").ms;
  const maxAgeDays = finiteAtLeast(options.maxAgeDays, 30, 0);
  const maxPoints = Math.floor(finiteAtLeast(options.maxPoints, 720, 1));
  const cutoff = pointTime - maxAgeDays * DAY_MS;
  const byTime = new Map<number, ControlHistoryPoint>();

  for (const candidate of history) {
    const parsed = isoTime(candidate.at);
    if (!parsed || parsed.ms < cutoff || parsed.ms > pointTime) continue;
    byTime.set(parsed.ms, { ...candidate, at: parsed.iso });
  }
  byTime.set(pointTime, point);

  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .slice(-maxPoints)
    .map(([, value]) => value);
}

function trend(values: readonly number[]): ControlTrendValue | null {
  if (!values.length) return null;
  const first = values[0];
  const latest = values[values.length - 1];
  return {
    first,
    latest,
    delta: rounded(latest - first),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function trendPresent(values: readonly (number | null)[]): ControlTrendValue | null {
  return trend(values.filter((value): value is number => value !== null && Number.isFinite(value)));
}

function summarizeWindow(
  history: readonly ControlHistoryPoint[],
  asOf: { iso: string; ms: number },
  days: 7 | 30,
): ControlTrendWindow {
  const fromMs = asOf.ms - days * DAY_MS;
  const points = history
    .map((point) => ({ point, parsed: isoTime(point.at) }))
    .filter((entry): entry is { point: ControlHistoryPoint; parsed: { iso: string; ms: number } } => (
      entry.parsed !== null && entry.parsed.ms >= fromMs && entry.parsed.ms <= asOf.ms
    ))
    .sort((left, right) => left.parsed.ms - right.parsed.ms);
  const sourceIds = [...new Set(points.flatMap(({ point }) => point.sources.map((source) => source.id)))].sort();
  const sources: ControlSourceTrend[] = [];

  for (const sourceId of sourceIds) {
    const samples = points.flatMap(({ point }) => {
      const source = point.sources.find((candidate) => candidate.id === sourceId);
      return source ? [source] : [];
    });
    if (!samples.length) continue;
    sources.push({
      sourceId,
      samples: samples.length,
      pages: trend(samples.map((source) => source.pages))!,
      chunks: trend(samples.map((source) => source.chunks))!,
      unembeddedChunks: trend(samples.map((source) => source.unembeddedChunks))!,
      embeddingCoveragePct: trend(samples.map((source) => source.embeddingCoveragePct))!,
      stalenessHours: trend(samples.map((source) => source.stalenessHours))!,
    });
  }

  return {
    days,
    from: new Date(fromMs).toISOString(),
    to: asOf.iso,
    samples: points.length,
    firstAt: points[0]?.parsed.iso ?? null,
    latestAt: points.at(-1)?.parsed.iso ?? null,
    totals: {
      pages: trend(points.map(({ point }) => point.totals.pages)),
      chunks: trend(points.map(({ point }) => point.totals.chunks)),
      unembeddedChunks: trend(points.map(({ point }) => point.totals.unembeddedChunks)),
      embeddingCoveragePct: trendPresent(points.map(({ point }) => point.totals.embeddingCoveragePct)),
      staleSources: trend(points.map(({ point }) => point.totals.staleSources)),
    },
    jobs: {
      queued: trend(points.map(({ point }) => point.jobs.queued)),
      active: trend(points.map(({ point }) => point.jobs.active)),
      completed: trend(points.map(({ point }) => point.jobs.completed)),
      failed: trend(points.map(({ point }) => point.jobs.failed)),
      dead: trend(points.map(({ point }) => point.jobs.dead)),
      cancelled: trend(points.map(({ point }) => point.jobs.cancelled)),
      successRatePct: trendPresent(points.map(({ point }) => point.jobs.successRatePct)),
      averageDurationMs: trendPresent(points.map(({ point }) => point.jobs.averageDurationMs)),
    },
    sources,
  };
}

/** compact point 목록에서 동일 기준 시각의 7일/30일 요약을 계산합니다. */
export function summarizeControlHistory(
  history: readonly ControlHistoryPoint[],
  asOf: string | Date,
): ControlHistorySummary {
  const parsed = requiredIsoTime(asOf, "asOf");
  return {
    generatedAt: parsed.iso,
    sevenDays: summarizeWindow(history, parsed, 7),
    thirtyDays: summarizeWindow(history, parsed, 30),
  };
}

function sourceForPreview(
  snapshot: ControlCenterResponse,
  sourceId: string,
): ControlSourceStatus | null {
  return snapshot.sources.find((source) => source.id === sourceId) ?? null;
}

function jobForPreview(snapshot: ControlCenterResponse, jobId: number): ControlJob | null {
  return snapshot.jobs.find((job) => job.id === jobId) ?? null;
}

function relevantJobNames(action: ControlActionName, targetJob?: ControlJob): Set<string> {
  switch (action) {
    case "quick-dream":
      return new Set(["autopilot-cycle", "sync", "embed", "embed-backfill"]);
    case "source-sync":
      return new Set(["autopilot-cycle", "sync"]);
    case "embedding-refresh":
      return new Set(["autopilot-cycle", "embed", "embed-backfill"]);
    case "job-retry":
    case "job-cancel":
      return new Set(targetJob ? [targetJob.name] : []);
  }
}

function durationJobNames(action: ControlActionName, targetJob?: ControlJob): Set<string> {
  switch (action) {
    case "quick-dream":
      return new Set(["autopilot-cycle"]);
    case "source-sync":
      return new Set(["sync"]);
    case "embedding-refresh":
      return new Set(["embed", "embed-backfill"]);
    case "job-retry":
    case "job-cancel":
      return new Set(targetJob ? [targetJob.name] : []);
  }
}

function durationLabel(minMs: number, maxMs: number): string {
  const short = (value: number) => {
    if (value < 60_000) return `${Math.max(1, Math.round(value / 1_000))}초`;
    if (value < 60 * 60_000) return `${Math.max(1, Math.round(value / 60_000))}분`;
    return `${rounded(value / (60 * 60_000), 1)}시간`;
  };
  return `${short(minMs)}–${short(maxMs)}`;
}

function defaultDuration(action: ControlActionName, workloadChunks: number): [number, number] {
  switch (action) {
    case "quick-dream":
      return [60_000, Math.max(10 * 60_000, workloadChunks * 2_000)];
    case "source-sync":
      return [15_000, 5 * 60_000];
    case "embedding-refresh":
      return [30_000, Math.max(3 * 60_000, workloadChunks * 3_000)];
    case "job-retry":
      return [30_000, 10 * 60_000];
    case "job-cancel":
      return [1_000, 30_000];
  }
}

function estimateDuration(
  snapshot: ControlCenterResponse,
  action: ControlActionName,
  sourceId: string | null,
  targetJob: ControlJob | undefined,
  workloadChunks: number,
): ControlActionPreview["duration"] {
  if (action === "job-cancel") {
    const [minMs, maxMs] = defaultDuration(action, workloadChunks);
    return { minMs, maxMs, label: durationLabel(minMs, maxMs), basis: "default-range", sampleSize: 0 };
  }
  const names = durationJobNames(action, targetJob);
  const durations = snapshot.jobs
    .filter((job) => (
      job.status === "completed"
      && job.durationMs > 0
      && names.has(job.name)
      && (sourceId === null || job.sourceId === sourceId)
    ))
    .map((job) => job.durationMs)
    .sort((left, right) => left - right)
    .slice(-5);
  if (!durations.length) {
    const [minMs, maxMs] = defaultDuration(action, workloadChunks);
    return { minMs, maxMs, label: durationLabel(minMs, maxMs), basis: "default-range", sampleSize: 0 };
  }
  const minimum = durations[0];
  const maximum = durations[durations.length - 1];
  const minMs = Math.max(1_000, Math.round(minimum * 0.8));
  const maxMs = Math.max(minMs, Math.round(maximum * 1.25));
  return {
    minMs,
    maxMs,
    label: durationLabel(minMs, maxMs),
    basis: "recent-jobs",
    sampleSize: durations.length,
  };
}

function previewWorkload(
  action: ControlActionName,
  source: ControlSourceStatus | null,
  targetJob?: ControlJob,
): ControlPreviewWorkload {
  if (!source || action === "job-cancel") {
    return {
      pages: null,
      chunks: null,
      qualifier: "not-applicable",
      label: "처리량을 별도로 계산하지 않습니다.",
    };
  }
  if (action === "embedding-refresh" || (action === "job-retry" && targetJob?.name === "embed")) {
    const chunks = Math.max(0, source.chunksUnembedded);
    return {
      pages: Math.min(source.pages, chunks),
      chunks,
      qualifier: "minimum",
      label: `최소 ${chunks} chunks · 영향 페이지는 최대 ${Math.min(source.pages, chunks)}개로 추정`,
    };
  }
  if (action === "source-sync" || (action === "job-retry" && targetJob?.name === "sync")) {
    return {
      pages: source.pages,
      chunks: source.chunksTotal,
      qualifier: "current-size",
      label: `현재 ${source.pages} pages / ${source.chunksTotal} chunks를 비교 기준으로 사용`,
    };
  }
  return {
    pages: source.pages,
    chunks: source.chunksTotal,
    qualifier: "upper-bound",
    label: `최대 ${source.pages} pages / ${source.chunksTotal} chunks가 단계별 처리 대상이 될 수 있음`,
  };
}

function previewFollowUps(action: ControlActionName): string[] {
  switch (action) {
    case "quick-dream":
      return ["완료 후 Source freshness와 Embedding 적용률을 다시 확인합니다.", "단계별 Job 결과를 Activity에서 확인합니다."];
    case "source-sync":
      return ["새로 들어온 페이지가 있으면 별도 관계 추출 또는 Embedding 갱신이 필요할 수 있습니다.", "완료 후 Source freshness를 다시 확인합니다."];
    case "embedding-refresh":
      return ["완료 후 미처리 chunk 수와 Embedding 적용률을 비교합니다."];
    case "job-retry":
      return ["재시도 Job의 단계 진행률과 최종 상태를 확인합니다."];
    case "job-cancel":
      return ["취소 반영 후 같은 Source의 대기 작업을 다시 확인합니다."];
  }
}

/**
 * 현재 정규화 snapshot만으로 실행 영향을 미리 계산합니다. 실제 dry-run이
 * 아니므로 반환값은 항상 isEstimate=true이며 작업을 실행하지 않습니다.
 */
export function buildControlActionPreview(
  snapshot: ControlCenterResponse,
  target: ControlActionPreviewTarget,
): ControlActionPreview | null {
  const targetJob = "jobId" in target ? jobForPreview(snapshot, target.jobId) : null;
  const sourceId = "sourceId" in target ? target.sourceId : targetJob?.sourceId ?? null;
  const source = sourceId ? sourceForPreview(snapshot, sourceId) : null;
  if ("sourceId" in target && !source) return null;
  if ("jobId" in target && !targetJob) return null;

  const workload = previewWorkload(target.action, source, targetJob ?? undefined);
  const names = relevantJobNames(target.action, targetJob ?? undefined);
  const conflicts = snapshot.jobs
    .filter((job) => (
      OPEN_JOB_STATUSES.has(job.status)
      && job.id !== targetJob?.id
      && names.has(job.name)
      && (sourceId === null || job.sourceId === sourceId)
    ))
    .map((job) => ({ jobId: job.id, label: job.label, status: job.status }))
    .sort((left, right) => left.jobId - right.jobId);
  const workloadChunks = workload.chunks ?? source?.chunksTotal ?? 0;
  const warnings = [
    ...(conflicts.length ? ["같은 대상과 겹칠 수 있는 실행 중 또는 대기 작업이 있습니다."] : []),
    ...(target.action === "source-sync"
      ? ["새 원격 변경량은 실행 전 snapshot만으로 정확히 알 수 없습니다."]
      : []),
    ...(target.action === "embedding-refresh" && source && source.chunksUnembedded === 0
      ? ["누락 chunk는 없지만 오래된 Embedding이 추가 처리될 수 있습니다."]
      : []),
  ];

  return {
    action: target.action,
    actionLabel: ACTION_LABELS[target.action],
    targetLabel: targetJob
      ? `${targetJob.label} #${targetJob.id}`
      : source
        ? source.name
        : "전체 Source",
    sourceId,
    jobId: targetJob?.id ?? null,
    isEstimate: true,
    estimateNotice: "현재 Control Center snapshot을 기반으로 한 추정치이며 실제 dry-run 결과가 아닙니다.",
    workload,
    duration: estimateDuration(
      snapshot,
      target.action,
      sourceId,
      targetJob ?? undefined,
      workloadChunks,
    ),
    conflicts,
    followUps: previewFollowUps(target.action),
    warnings,
  };
}

interface MetricValue {
  key: string;
  label: string;
  value: number;
  unit: ControlMetricDiff["unit"];
  lowerIsBetter: boolean;
}

function aggregateSnapshotMetrics(snapshot: ControlCenterResponse): MetricValue[] {
  const pages = snapshot.sources.reduce((sum, source) => sum + source.pages, 0);
  const chunks = snapshot.sources.reduce((sum, source) => sum + source.chunksTotal, 0);
  const unembedded = snapshot.sources.reduce((sum, source) => sum + source.chunksUnembedded, 0);
  const staleness = snapshot.sources.length
    ? snapshot.sources.reduce((sum, source) => sum + source.stalenessHours, 0) / snapshot.sources.length
    : 0;
  return [
    { key: "pages", label: "Pages", value: pages, unit: "count", lowerIsBetter: false },
    { key: "chunks", label: "Chunks", value: chunks, unit: "count", lowerIsBetter: false },
    { key: "unembedded", label: "미처리 Embedding", value: unembedded, unit: "count", lowerIsBetter: true },
    {
      key: "coverage",
      label: "Embedding 적용률",
      value: chunks > 0 ? ((chunks - Math.min(chunks, unembedded)) / chunks) * 100 : 0,
      unit: "percent",
      lowerIsBetter: false,
    },
    { key: "staleness", label: "평균 Source 경과", value: staleness, unit: "hours", lowerIsBetter: true },
    {
      key: "failed-jobs",
      label: "실패 또는 Dead Jobs",
      value: snapshot.recentJobCounts.failed + snapshot.recentJobCounts.dead,
      unit: "count",
      lowerIsBetter: true,
    },
    {
      key: "queued-jobs",
      label: "대기 Jobs",
      value: snapshot.recentJobCounts.waiting
        + snapshot.recentJobCounts.waitingChildren
        + snapshot.recentJobCounts.paused
        + snapshot.recentJobCounts.delayed,
      unit: "count",
      lowerIsBetter: true,
    },
  ];
}

function sourceMetrics(source: ControlSourceStatus): MetricValue[] {
  return [
    { key: "pages", label: "Pages", value: source.pages, unit: "count", lowerIsBetter: false },
    { key: "chunks", label: "Chunks", value: source.chunksTotal, unit: "count", lowerIsBetter: false },
    { key: "unembedded", label: "미처리 Embedding", value: source.chunksUnembedded, unit: "count", lowerIsBetter: true },
    { key: "coverage", label: "Embedding 적용률", value: source.embeddingCoveragePct, unit: "percent", lowerIsBetter: false },
    { key: "staleness", label: "마지막 동기화 경과", value: source.stalenessHours, unit: "hours", lowerIsBetter: true },
  ];
}

function diffTone(delta: number, lowerIsBetter: boolean): ControlTone {
  if (delta === 0) return "neutral";
  return (lowerIsBetter ? delta < 0 : delta > 0) ? "good" : "warning";
}

/**
 * action 전/후 snapshot의 운영 지표 차이를 계산합니다. sourceId를 주면 해당
 * Source만 비교하고, 생략하면 전체 Source와 Job 요약을 비교합니다.
 */
export function diffControlMetrics(
  before: ControlCenterResponse,
  after: ControlCenterResponse,
  sourceId?: string,
): ControlMetricDiffResult {
  const beforeAt = requiredIsoTime(before.generatedAt, "before.generatedAt").iso;
  const afterAt = requiredIsoTime(after.generatedAt, "after.generatedAt").iso;
  const warnings: string[] = [];
  let beforeMetrics: MetricValue[];
  let afterMetrics: MetricValue[];

  if (sourceId) {
    const beforeSource = before.sources.find((source) => source.id === sourceId);
    const afterSource = after.sources.find((source) => source.id === sourceId);
    if (!beforeSource || !afterSource) {
      if (!beforeSource) warnings.push(`변경 전 snapshot에서 Source ${sourceId}를 찾을 수 없습니다.`);
      if (!afterSource) warnings.push(`변경 후 snapshot에서 Source ${sourceId}를 찾을 수 없습니다.`);
      return {
        scope: "source",
        sourceId,
        beforeAt,
        afterAt,
        metrics: [],
        warnings,
      };
    }
    beforeMetrics = sourceMetrics(beforeSource);
    afterMetrics = sourceMetrics(afterSource);
  } else {
    beforeMetrics = aggregateSnapshotMetrics(before);
    afterMetrics = aggregateSnapshotMetrics(after);
  }

  const afterByKey = new Map(afterMetrics.map((metric) => [metric.key, metric]));
  const metrics = beforeMetrics.flatMap((metric) => {
    const next = afterByKey.get(metric.key);
    if (!next) return [];
    const beforeValue = rounded(metric.value);
    const afterValue = rounded(next.value);
    const delta = rounded(afterValue - beforeValue);
    return [{
      key: metric.key,
      label: metric.label,
      before: beforeValue,
      after: afterValue,
      delta,
      unit: metric.unit,
      direction: delta > 0 ? "up" as const : delta < 0 ? "down" as const : "same" as const,
      tone: diffTone(delta, metric.lowerIsBetter),
      lowerIsBetter: metric.lowerIsBetter,
    }];
  });

  return {
    scope: sourceId ? "source" : "all-sources",
    sourceId: sourceId ?? null,
    beforeAt,
    afterAt,
    metrics,
    warnings,
  };
}
