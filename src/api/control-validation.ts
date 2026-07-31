import { z } from "zod";
import type {
  ControlActionResult,
  ControlCenterResponse,
  ControlDreamRunDetail,
  ControlJobStatus,
  ControlPhaseStatus,
  ControlTone,
} from "./types";

const JOB_STATUSES = new Set<ControlJobStatus>([
  "waiting", "waiting-children", "paused", "active", "completed", "failed",
  "delayed", "dead", "cancelled", "unknown",
]);
const PHASE_STATUSES = new Set<ControlPhaseStatus>(["ok", "warn", "fail", "skipped", "running", "unknown"]);
const TONES = new Set<ControlTone>(["neutral", "good", "warning", "danger"]);
const phaseCode = z.enum([
  "migration_required",
  "feature_disabled",
  "pack_gated",
  "insufficient_evidence",
  "budget_exhausted",
]);

export function normalizeControlJobStatus(value: unknown): ControlJobStatus {
  return typeof value === "string" && JOB_STATUSES.has(value as ControlJobStatus)
    ? value as ControlJobStatus
    : "unknown";
}

export function normalizeControlPhaseStatus(value: unknown): ControlPhaseStatus {
  return typeof value === "string" && PHASE_STATUSES.has(value as ControlPhaseStatus)
    ? value as ControlPhaseStatus
    : "unknown";
}

function normalizeControlTone(value: unknown): ControlTone {
  return typeof value === "string" && TONES.has(value as ControlTone) ? value as ControlTone : "neutral";
}

const finite = z.number().finite();
const nullableText = z.string().nullable();
const jobStatus = z.unknown().transform(normalizeControlJobStatus);
const phaseStatus = z.unknown().transform(normalizeControlPhaseStatus);
const tone = z.unknown().transform(normalizeControlTone);

const metric = z.object({
  key: z.string(),
  label: z.string(),
  value: finite,
  tone,
});

const phase = z.object({
  name: z.string(),
  label: z.string(),
  status: phaseStatus,
  durationMs: finite.nonnegative(),
  summary: z.string(),
  metrics: z.array(metric),
  warnings: z.array(z.string()),
  codes: z.array(phaseCode).optional(),
});

const run = z.object({
  id: finite.int().nullable(),
  name: z.string(),
  label: z.string(),
  jobStatus,
  reportStatus: phaseStatus,
  sourceId: nullableText,
  startedAt: nullableText,
  finishedAt: nullableText,
  durationMs: finite.nonnegative(),
  partial: z.boolean(),
  phases: z.array(phase),
  impacts: z.array(metric),
  warnings: z.array(z.string()),
});

const progress = z.object({
  phase: nullableText,
  message: nullableText,
  completed: finite.nullable(),
  total: finite.nullable(),
  percent: finite.nullable(),
});

const job = z.object({
  id: finite.int().nonnegative(),
  parentId: finite.int().nullable().optional(),
  name: z.string(),
  label: z.string(),
  queue: z.string(),
  status: jobStatus,
  sourceId: nullableText,
  createdAt: nullableText,
  startedAt: nullableText,
  finishedAt: nullableText,
  durationMs: finite.nonnegative(),
  attemptsMade: finite.nonnegative(),
  maxAttempts: finite.nonnegative(),
  error: nullableText,
  progress: progress.nullable(),
  run: run.nullable(),
});

const sourceStatus = z.object({
  id: z.string(),
  name: z.string(),
  syncEnabled: z.boolean(),
  lastSyncAt: nullableText,
  stalenessHours: finite.nonnegative(),
  stalenessClass: z.unknown().transform((value): ControlCenterResponse["sources"][number]["stalenessClass"] => (
    value === "fresh" || value === "aging" || value === "stale" ? value : "unknown"
  )),
  pages: finite.nonnegative(),
  chunksTotal: finite.nonnegative(),
  chunksUnembedded: finite.nonnegative(),
  embeddingCoveragePct: finite,
  backfillQueued: finite.nonnegative(),
  backfillActive: finite.nonnegative(),
});

const recentCounts = z.object({
  sampleSize: finite.nonnegative(),
  waiting: finite.nonnegative(),
  waitingChildren: finite.nonnegative(),
  paused: finite.nonnegative(),
  active: finite.nonnegative(),
  completed: finite.nonnegative(),
  failed: finite.nonnegative(),
  delayed: finite.nonnegative(),
  dead: finite.nonnegative(),
  cancelled: finite.nonnegative(),
  unknown: finite.nonnegative(),
});

const sectionFreshness = z.enum(["fresh", "stale", "unavailable"]);

const quality = z.object({
  status: sectionFreshness,
  recentJobs: sectionFreshness,
  sourceDreamRuns: sectionFreshness,
  globalDreamRuns: sectionFreshness,
});

const controlCenterResponse = z.object({
  generatedAt: z.string(),
  availability: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    message: nullableText,
  }),
  management: z.object({
    enabled: z.boolean(),
    confirmationRequired: z.literal(true),
  }),
  version: nullableText,
  sources: z.array(sourceStatus),
  latestFullRun: run.nullable(),
  latestTargetedRun: run.nullable(),
  recentJobCounts: recentCounts,
  jobs: z.array(job),
  dreamRuns: z.array(run).optional(),
  quality: quality.optional(),
});

const dreamMetricComparison = z.object({
  key: z.string(),
  label: z.string(),
  current: finite,
  previous: finite,
  delta: finite,
});

const dreamFinding = z.object({
  id: z.string(),
  kind: z.enum(["failure", "warning", "remediation", "metric", "duration"]),
  phase: nullableText,
  label: z.string(),
  detail: z.string(),
});

const affectedPage = z.object({
  sourceId: z.string(),
  slug: z.string(),
  phases: z.array(z.string()),
});

const controlDreamRunDetail = z.object({
  snapshotGeneratedAt: z.string(),
  stale: z.boolean(),
  run,
  previousRun: run.nullable(),
  comparison: z.object({ metrics: z.array(dreamMetricComparison) }),
  findings: z.array(dreamFinding).max(5),
  affectedPages: z.object({
    items: z.array(affectedPage).max(200),
    total: finite.int().nonnegative(),
    truncated: z.boolean(),
    coverage: z.enum(["complete", "partial", "unavailable"]).default("unavailable"),
  }),
});

const actionJob = z.object({
  id: finite.int().positive(),
  name: z.string(),
  label: z.string(),
  status: jobStatus,
  sourceId: nullableText,
  createdAt: nullableText,
});

const controlActionResult = z.object({
  actionId: z.string(),
  action: z.enum(["quick-dream", "source-sync", "embedding-refresh", "job-retry", "job-cancel"]),
  outcome: z.enum(["accepted", "pending-verification"]),
  replayed: z.boolean(),
  message: z.string(),
  generatedAt: z.string(),
  job: actionJob.nullable(),
});

export function parseControlCenterResponse(value: unknown): ControlCenterResponse {
  return controlCenterResponse.parse(value) as ControlCenterResponse;
}

/** Keep the browser-side Dream detail boundary allowlist-only as well. */
export function parseControlDreamRunDetail(value: unknown): ControlDreamRunDetail {
  return controlDreamRunDetail.parse(value) as ControlDreamRunDetail;
}

export function parseControlActionResult(value: unknown): ControlActionResult {
  return controlActionResult.parse(value) as ControlActionResult;
}
