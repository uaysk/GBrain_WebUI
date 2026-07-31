import type {
  ControlAffectedPages,
  ControlCenterResponse,
  ControlDreamFinding,
  ControlDreamMetricComparison,
  ControlDreamRunDetail,
  ControlJob,
  ControlJobProgress,
  ControlJobStatus,
  ControlMetric,
  ControlPhase,
  ControlPhaseCode,
  ControlPhaseStatus,
  ControlRecentJobCounts,
  ControlRun,
  ControlSourceStatus,
  ControlTone,
} from "../shared/contracts";

type JsonRecord = Record<string, unknown>;

export const DREAM_JOB_NAMES = ["autopilot-cycle", "autopilot-global-maintenance"] as const;
const DREAM_JOB_NAME_SET = new Set<string>(DREAM_JOB_NAMES);
const AFFECTED_PAGE_LIMIT = 200;
const AFFECTED_PAGE_INPUT_LIMIT = 10_000;

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

const PHASE_ORDER = Object.keys(PHASE_LABELS);

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
  pages_affected: { label: "영향받은 페이지", tone: "good" },
  transcripts_discovered: { label: "발견된 대화" },
  links_created: { label: "생성 관계", tone: "good" },
  timeline_created: { label: "Timeline 항목", tone: "good" },
  slugs_targeted: { label: "대상 페이지" },
  pages_with_facts: { label: "Fact 포함 페이지" },
  facts_inserted: { label: "삽입된 Facts", tone: "good" },
  facts_deleted: { label: "교체된 Facts", tone: "warning" },
  phantoms_scanned: { label: "검사한 가상 링크" },
  phantoms_skipped_drift: { label: "Drift로 보류", tone: "warning" },
  phantoms_lock_busy: { label: "Lock으로 보류", tone: "warning" },
  phantoms_more_pending: { label: "남은 가상 링크", tone: "warning" },
  atoms_extracted: { label: "추출된 Atoms", tone: "good" },
  transcripts_total: { label: "전체 대화" },
  transcripts_skipped_budget: { label: "예산으로 보류된 대화", tone: "warning" },
  pages_processed: { label: "처리 페이지", tone: "good" },
  pages_total: { label: "전체 페이지" },
  pages_skipped_budget: { label: "예산으로 보류된 페이지", tone: "warning" },
  duplicates_skipped: { label: "중복으로 건너뜀" },
  estimated_spend_usd: { label: "예상 비용 (USD)" },
  reflections_considered: { label: "검토한 Reflections" },
  reverse_write_count: { label: "역방향 기록", tone: "good" },
  concepts_written: { label: "작성 Concepts", tone: "good" },
  groups_found: { label: "발견 그룹" },
  atoms_seen: { label: "검토 Atoms" },
  takes_scanned: { label: "검토 Takes" },
  too_recent: { label: "평가 시기 미도래" },
  verdicts_written: { label: "작성 Verdicts", tone: "good" },
  auto_applied: { label: "자동 반영", tone: "good" },
  ensemble_invoked: { label: "Ensemble 실행" },
  ensemble_unanimous: { label: "Ensemble 만장일치", tone: "good" },
  profile_written: { label: "작성 Profile", tone: "good" },
  voice_gate_passed: { label: "Voice gate 통과", tone: "good" },
  voice_gate_attempts: { label: "Voice gate 시도" },
  total_resolved: { label: "해결된 Takes", tone: "good" },
  brier: { label: "Brier score" },
  sources_count: { label: "전체 Sources" },
  sources_processed: { label: "처리 Sources", tone: "good" },
  pages_skipped: { label: "건너뛴 페이지", tone: "warning" },
  spent_usd: { label: "처리 비용 (USD)" },
  skipped_by_brain_wide_cap: { label: "전체 예산으로 보류", tone: "warning" },
  skipped_by_brain_wide_walltime: { label: "시간 제한으로 보류", tone: "warning" },
  pages_enriched: { label: "보강 페이지", tone: "good" },
  pages_skipped_insufficient: { label: "근거 부족으로 보류", tone: "warning" },
  skills_scanned: { label: "검사 Skills" },
  accepted: { label: "개선 채택", tone: "good" },
  no_improvement: { label: "개선 없음" },
  errored: { label: "오류", tone: "danger" },
  skipped_brain_wide_cap: { label: "전체 예산으로 보류", tone: "warning" },
  cumulative_cost_usd: { label: "누적 비용 (USD)" },
  chunks_walked: { label: "검사 Chunks" },
  edges_unmatched: { label: "미해결 관계", tone: "warning" },
  sources_walked: { label: "검사 Sources" },
  total_chunks: { label: "전체 Chunks" },
  would_embed: { label: "Embedding 예정" },
  total_orphans: { label: "고립 페이지", tone: "warning" },
  total_pages: { label: "전체 페이지" },
  purged_orphan_clones_count: { label: "정리된 임시 Clone", tone: "warning" },
};

const METRIC_ALIASES: Record<string, readonly string[]> = {
  failedFiles: ["failed_files"],
  chunksCreated: ["chunks_created"],
  chunksProcessed: ["chunks_processed"],
  pagesAffected: ["pages_affected"],
  pagesProcessed: ["pages_processed"],
  spentUsd: ["spent_usd"],
  linksCreated: ["links_created"],
  timelineCreated: ["timeline_created"],
  legacyRowsPending: ["legacy_rows_pending"],
  pages_scanned: ["pagesScanned"],
  pages_with_facts: ["pagesWithFacts"],
  facts_inserted: ["factsInserted"],
  facts_deleted: ["factsDeleted"],
  pages_recomputed: ["pagesRecomputed"],
  takes_written: ["takesWritten"],
  buckets_processed: ["bucketsProcessed"],
  buckets_skipped: ["bucketsSkipped"],
  pages_processed: ["pagesProcessed"],
  spent_usd: ["spentUsd"],
  pages_embedded: ["pagesEmbedded"],
  pages_synced: ["pagesSynced"],
  pages_extracted: ["pagesExtracted"],
  backlinks_added: ["backlinksAdded"],
  orphans_found: ["orphansFound"],
  patterns_written: ["patternsWritten"],
  facts_consolidated: ["factsConsolidated"],
  consolidate_takes_written: ["consolidateTakesWritten"],
};

const TOTAL_METRIC_KEYS = [
  "lint_fixes", "pages_synced", "orphans_found", "edges_resolved", "pages_embedded",
  "backlinks_added", "edges_ambiguous", "pages_extracted", "patterns_written",
  "facts_consolidated", "purged_pages_count", "purged_sources_count", "synth_pages_written",
  "transcripts_processed", "consolidate_takes_written", "pages_emotional_weight_recomputed",
  "phantom_redirected", "phantoms_redirected", "phantoms_ambiguous", "phantom_ambiguous",
] as const;

const GENERIC_JOB_METRIC_KEYS = [
  "fixed", "fixes", "issues", "pages_scanned", "gaps", "added", "deleted", "renamed", "modified",
  "failedFiles", "chunksCreated", "chunksProcessed", "pagesAffected", "pagesProcessed", "spentUsd",
  "pages_written", "linksCreated", "timelineCreated", "legacyRowsPending", "pages_recomputed",
  "takes_written", "buckets_processed", "buckets_skipped", "cache_hits", "cache_misses",
  "proposals_inserted", "suggestions_emitted", "embedded", "deferred", "extracted", "remaining",
] as const;

const PHASE_METRIC_KEYS: Record<string, readonly string[]> = {
  lint: ["issues", "fixed", "pages_scanned"],
  backlinks: ["gaps", "added", "pages_affected"],
  sync: ["added", "modified", "deleted", "renamed", "chunksCreated", "failedFiles"],
  synthesize: ["transcripts_discovered", "transcripts_processed", "pages_written", "reverse_write_count"],
  extract: ["linksCreated", "timelineCreated", "pages_processed", "slugs_targeted"],
  extract_facts: ["legacyRowsPending", "pages_scanned", "pages_with_facts", "facts_inserted", "facts_deleted", "phantoms_scanned", "phantoms_redirected", "phantoms_ambiguous", "phantoms_skipped_drift", "phantoms_lock_busy", "phantoms_more_pending"],
  extract_atoms: ["atoms_extracted", "transcripts_processed", "transcripts_total", "transcripts_skipped_budget", "pages_processed", "pages_total", "pages_skipped_budget", "duplicates_skipped", "estimated_spend_usd"],
  resolve_symbol_edges: ["chunks_walked", "edges_resolved", "edges_ambiguous", "edges_unmatched", "sources_walked"],
  patterns: ["reflections_considered", "patterns_written", "reverse_write_count"],
  synthesize_concepts: ["concepts_written", "groups_found", "atoms_seen", "estimated_spend_usd"],
  recompute_emotional_weight: ["pages_recomputed"],
  consolidate: ["facts_consolidated", "takes_written", "buckets_processed", "buckets_skipped"],
  propose_takes: ["pages_scanned", "cache_hits", "cache_misses", "proposals_inserted"],
  grade_takes: ["takes_scanned", "too_recent", "cache_hits", "verdicts_written", "auto_applied", "ensemble_invoked", "ensemble_unanimous"],
  calibration_profile: ["profile_written", "voice_gate_passed", "voice_gate_attempts", "total_resolved", "brier"],
  conversation_facts_backfill: ["sources_count", "sources_processed", "pages_processed", "pages_skipped", "facts_inserted", "spent_usd", "skipped_by_brain_wide_cap", "skipped_by_brain_wide_walltime"],
  enrich_thin: ["sources_count", "sources_processed", "pages_enriched", "pages_skipped_insufficient", "spent_usd", "skipped_by_brain_wide_walltime"],
  skillopt: ["skills_scanned", "accepted", "no_improvement", "errored", "skipped_brain_wide_cap", "cumulative_cost_usd"],
  embed: ["embedded", "would_embed", "total_chunks", "pages_processed"],
  orphans: ["total_orphans", "total_pages"],
  "schema-suggest": ["suggestions_emitted"],
  purge: ["purged_sources_count", "purged_pages_count", "purged_orphan_clones_count"],
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
    .replace(/(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s]+/gi, "<redacted-database-url>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, "<redacted-url>")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential)\s*[:=]\s*["']?[^\s"',}]+/gi, "$1=<redacted>")
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

function metricValue(source: JsonRecord, key: string): number {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const camel = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  const candidates = new Set([key, snake, camel, ...(METRIC_ALIASES[key] ?? [])]);
  for (const candidate of candidates) {
    if (!(candidate in source)) continue;
    const value = number(source[candidate], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function metricsFrom(
  value: unknown,
  includeZero = false,
  keys: readonly string[] = [...TOTAL_METRIC_KEYS, ...GENERIC_JOB_METRIC_KEYS],
): ControlMetric[] {
  const source = record(value);
  const metrics: ControlMetric[] = [];
  for (const key of keys) {
    const meta = METRIC_LABELS[key];
    if (!meta) continue;
    const value = metricValue(source, key);
    if (!Number.isFinite(value) || (!includeZero && value === 0)) continue;
    metrics.push({ key, label: meta.label, value, tone: toneForMetric(key, value) });
  }
  return metrics;
}

const PHASE_CODE_COPY: Record<ControlPhaseCode, { label: string; detail: string }> = {
  migration_required: {
    label: "Migration 필요",
    detail: "호환성 migration을 적용한 뒤 이 단계를 다시 확인하세요.",
  },
  feature_disabled: {
    label: "기능 비활성화",
    detail: "이 단계는 현재 설정에서 비활성화되어 있습니다.",
  },
  pack_gated: {
    label: "Pack에서 제외됨",
    detail: "활성 lens pack이 이 단계를 선언하지 않았습니다.",
  },
  insufficient_evidence: {
    label: "근거 부족",
    detail: "안전한 결과를 만들기 위한 근거가 충분하지 않았습니다.",
  },
  budget_exhausted: {
    label: "예산 소진",
    detail: "이 실행에 설정된 처리 예산에 도달했습니다.",
  },
};

const PHASE_CODE_ORDER = Object.keys(PHASE_CODE_COPY) as ControlPhaseCode[];

function booleanField(source: JsonRecord, key: string): boolean {
  const camel = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return boolean(source[key]) || boolean(source[camel]);
}

function phaseCodes(details: JsonRecord, error: JsonRecord): ControlPhaseCode[] {
  const reason = text(details.reason).toLowerCase();
  const skipped = text(details.skipped).toLowerCase();
  const errorCode = text(error.code).toLowerCase();
  const present = new Set<ControlPhaseCode>();
  if (
    booleanField(details, "migration_required")
    || metricValue(details, "legacyRowsPending") > 0
    || reason === "migration_required"
    || errorCode === "migration_required"
  ) present.add("migration_required");
  if (
    booleanField(details, "feature_disabled")
    || reason === "disabled"
    || reason === "feature_flag_off"
    || reason === "not_configured"
    || reason === "no_api_key"
    || reason === "no_chat_gateway"
    || errorCode === "feature_disabled"
  ) present.add("feature_disabled");
  if (
    booleanField(details, "pack_gated")
    || reason === "not_in_active_pack"
    || errorCode === "pack_gated"
  ) present.add("pack_gated");
  if (
    booleanField(details, "insufficient_evidence")
    || reason === "insufficient_evidence"
    || reason === "insufficient_data"
    || skipped === "insufficient_data"
    || errorCode === "insufficient_evidence"
  ) present.add("insufficient_evidence");
  if (
    booleanField(details, "budget_exhausted")
    || reason === "budget_exhausted"
    || errorCode === "budget_exhausted"
  ) present.add("budget_exhausted");
  return PHASE_CODE_ORDER.filter((code) => present.has(code));
}

export function normalizeControlPhase(value: unknown): ControlPhase {
  const source = record(value);
  const details = record(source.details);
  const error = record(source.error);
  const name = safeMachineName(source.phase, "unknown");
  const codes = phaseCodes(details, error);
  return {
    name,
    label: PHASE_LABELS[name] ?? name.replaceAll("_", " "),
    status: phaseStatus(source.status),
    durationMs: Math.max(0, number(source.duration_ms)),
    summary: scrubText(source.summary, "단계 결과가 제공되지 않았습니다."),
    metrics: metricsFrom(details, false, PHASE_METRIC_KEYS[name] ?? []),
    warnings: codes.map((code) => PHASE_CODE_COPY[code].detail),
    codes,
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

export interface NormalizedDreamRunEntry {
  run: ControlRun;
  affectedPages: ControlAffectedPages;
  comparisonMetrics: ControlMetric[];
}

function validSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value;
  if (
    !candidate
    || candidate.length > 255
    || candidate !== candidate.trim()
    || candidate !== candidate.normalize("NFKC")
    || candidate !== candidate.toLowerCase()
    || candidate.startsWith("/")
    || candidate.endsWith("/")
    || candidate.includes("\\")
    || /[\x00-\x1f\x7f-\x9f]/.test(candidate)
    || /[\u202a-\u202e\u2066-\u2069]/.test(candidate)
    || /%2e|%2f|%5c/i.test(candidate)
  ) {
    return null;
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N}._/ -]*$/u.test(candidate) ? candidate : null;
}

function knownPhaseNames(value: unknown): string[] {
  const found = new Set(
    list(value)
      .map((phase) => safeMachineName(phase, "unknown"))
      .filter((phase) => phase in PHASE_LABELS),
  );
  return PHASE_ORDER.filter((phase) => found.has(phase));
}

function validSourceId(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const candidate = value;
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(candidate) ? candidate : null;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function aliasedField(container: JsonRecord, keys: readonly string[]): { present: boolean; valid: boolean; value?: unknown } {
  const present = keys.filter((key) => Object.hasOwn(container, key));
  if (present.length === 0) return { present: false, valid: true };
  if (present.length !== 1) return { present: true, valid: false };
  return { present: true, valid: true, value: container[present[0]] };
}

function emptyAffectedPages(): ControlAffectedPages {
  return { items: [], total: 0, truncated: false, coverage: "unavailable" };
}

function legacyAffectedPages(
  report: JsonRecord,
  run: ControlRun,
  allowedSourceIds?: readonly string[],
): ControlAffectedPages {
  const sourceId = validSourceId(run.sourceId);
  if (
    run.name !== "autopilot-cycle"
    || run.jobStatus !== "completed"
    || report.schema_version !== "1"
    || !sourceId
    || (allowedSourceIds && !new Set(allowedSourceIds).has(sourceId))
  ) return emptyAffectedPages();

  const byPage = new Map<string, { sourceId: string; slug: string; phases: Set<string> }>();
  let sawAcceptedField = false;
  let rejected = false;
  const add = (value: unknown, phase: string) => {
    const slug = validSlug(value);
    if (!slug) {
      rejected = true;
      return;
    }
    const key = `${sourceId}\0${slug}`;
    const current = byPage.get(key) ?? { sourceId, slug, phases: new Set<string>() };
    current.phases.add(phase);
    byPage.set(key, current);
  };
  const addList = (value: unknown, phase: string) => {
    if (!Array.isArray(value) || value.length > AFFECTED_PAGE_INPUT_LIMIT) {
      rejected = true;
      return;
    }
    for (const item of value) add(item, phase);
  };

  // GBrain <=0.42.58 already emits these deterministic structured fields.
  // Never recurse through arbitrary details, summaries, child output, or logs.
  for (const value of list(report.phases)) {
    const phase = record(value);
    const name = text(phase.phase);
    if (name === "sync") {
      const refs = aliasedField(phase, ["pagesAffected", "pages_affected"]);
      if (!refs.present) continue;
      const details = record(phase.details);
      const dryRun = aliasedField(details, ["dryRun", "dry_run"]);
      const syncStatus = aliasedField(details, ["syncStatus", "sync_status"]);
      if (
        !refs.valid
        || !dryRun.valid
        || !syncStatus.valid
        || !dryRun.present
        || dryRun.value !== false
        || !syncStatus.present
        || !new Set(["synced", "blocked_by_failures", "partial"]).has(text(syncStatus.value))
        || !new Set(["ok", "warn"]).has(text(phase.status))
      ) {
        rejected = true;
        continue;
      }
      sawAcceptedField = true;
      addList(refs.value, name);
    } else if (name === "synthesize") {
      const details = record(phase.details);
      const refs = aliasedField(details, ["written_slugs", "writtenSlugs"]);
      const summary = aliasedField(details, ["summary_slug", "summarySlug"]);
      if (!refs.present && !summary.present) continue;
      // The installed 0.42.58 producer hard-codes synth writes to default.
      // A non-default job source therefore cannot safely bind these bare slugs.
      if (sourceId !== "default") continue;
      const pagesWritten = aliasedField(details, ["pages_written", "pagesWritten"]);
      if (
        !refs.present
        || !refs.valid
        || !summary.valid
        || !pagesWritten.present
        || !pagesWritten.valid
        || text(phase.status) !== "ok"
        || typeof pagesWritten.value !== "number"
        || !Number.isInteger(pagesWritten.value)
        || pagesWritten.value < 0
        || !Array.isArray(refs.value)
        || pagesWritten.value !== refs.value.length
      ) {
        rejected = true;
        continue;
      }
      sawAcceptedField = true;
      addList(refs.value, name);
      if (summary.present) {
        if (typeof summary.value !== "string" || !/^dream-cycle-summaries\/\d{4}-\d{2}-\d{2}$/.test(summary.value)) {
          rejected = true;
        } else {
          add(summary.value, name);
        }
      }
    }
  }

  if (rejected) return emptyAffectedPages();

  const normalized = [...byPage.values()]
    .sort((left, right) => codeUnitCompare(left.sourceId, right.sourceId) || codeUnitCompare(left.slug, right.slug))
    .map((item) => ({
      sourceId: item.sourceId,
      slug: item.slug,
      phases: PHASE_ORDER.filter((phase) => item.phases.has(phase)),
    }));
  const items = normalized.slice(0, AFFECTED_PAGE_LIMIT);
  return {
    items,
    total: normalized.length,
    truncated: normalized.length > items.length,
    coverage: sawAcceptedField ? "partial" : "unavailable",
  };
}

function normalizeAffectedPages(
  report: JsonRecord,
  run: ControlRun,
  allowedSourceIds?: readonly string[],
): ControlAffectedPages {
  const aggregate = aliasedField(report, ["affected_pages", "affectedPages"]);
  if (!aggregate.present) return legacyAffectedPages(report, run, allowedSourceIds);
  if (!aggregate.valid || report.schema_version !== "1") return emptyAffectedPages();
  const source = record(aggregate.value);
  if (
    !aggregate.value
    || Array.isArray(aggregate.value)
    || !Array.isArray(source.items)
    || source.items.length > AFFECTED_PAGE_INPUT_LIMIT
    || typeof source.total !== "number"
    || !Number.isSafeInteger(source.total)
    || source.total < 0
    || typeof source.truncated !== "boolean"
  ) return emptyAffectedPages();
  const rawItems = source.items;
  const allowed = allowedSourceIds ? new Set(allowedSourceIds) : null;
  const byPage = new Map<string, { sourceId: string; slug: string; phases: Set<string> }>();
  let rejected = false;
  for (const value of rawItems) {
    const item = record(value);
    const itemSource = aliasedField(item, ["source_id", "sourceId"]);
    const sourceId = itemSource.present && itemSource.valid ? validSourceId(itemSource.value) : null;
    const slug = validSlug(item.slug);
    const phases = knownPhaseNames(item.phases);
    if (
      !sourceId
      || !slug
      || phases.length === 0
      || (allowed && !allowed.has(sourceId))
      || (run.sourceId !== null && sourceId !== run.sourceId)
    ) {
      rejected = true;
      break;
    }
    const key = `${sourceId}\0${slug}`;
    const current = byPage.get(key) ?? { sourceId, slug, phases: new Set<string>() };
    for (const phase of phases) current.phases.add(phase);
    byPage.set(key, current);
  }
  if (rejected) return emptyAffectedPages();
  const normalized = [...byPage.values()]
    .sort((left, right) => codeUnitCompare(left.sourceId, right.sourceId) || codeUnitCompare(left.slug, right.slug))
    .map((item) => ({
      sourceId: item.sourceId,
      slug: item.slug,
      phases: PHASE_ORDER.filter((phase) => item.phases.has(phase)),
    }));
  const items = normalized.slice(0, AFFECTED_PAGE_LIMIT);
  const reportedTotal = source.total;
  if (reportedTotal < normalized.length || (!source.truncated && reportedTotal > normalized.length)) return emptyAffectedPages();
  return {
    items,
    total: reportedTotal,
    truncated: source.truncated || normalized.length > AFFECTED_PAGE_LIMIT || reportedTotal > items.length,
    coverage: source.truncated
      || normalized.length > AFFECTED_PAGE_LIMIT
      || reportedTotal > items.length
      ? "partial"
      : "complete",
  };
}

export function controlAllSourcesVisible(statusValue: unknown, allowedSourceIds?: readonly string[]): boolean {
  if (!allowedSourceIds) return true;
  const sourceStatuses = list(record(record(statusValue).sync).sources).map(normalizeControlSource);
  const allowed = new Set(allowedSourceIds);
  return sourceStatuses.length > 0 && sourceStatuses.every((source) => allowed.has(source.id));
}

function jobIsVisible(job: ControlJob, allowedSourceIds: readonly string[] | undefined, allowSourceless: boolean): boolean {
  if (!allowedSourceIds) return job.sourceId !== "unknown";
  if (job.sourceId) return new Set(allowedSourceIds).has(job.sourceId);
  return allowSourceless;
}

export function normalizeControlDreamRuns(
  values: unknown[],
  allowedSourceIds?: readonly string[],
  allowSourcelessGlobal = false,
  onNormalizationError?: () => void,
): NormalizedDreamRunEntry[] {
  const entries: NormalizedDreamRunEntry[] = [];
  for (const value of values) {
    try {
      const source = record(value);
      const job = normalizeControlJob(source);
      if (!job.run || job.id <= 0 || !DREAM_JOB_NAME_SET.has(job.name)) continue;
      if (job.name === "autopilot-cycle" && !job.sourceId) continue;
      if (!jobIsVisible(job, allowedSourceIds, job.name === "autopilot-global-maintenance" && allowSourcelessGlobal)) continue;
      const report = reportFromJob(source);
      const metricSource = Object.keys(record(report.totals)).length ? report.totals : report;
      entries.push({
        run: job.run,
        affectedPages: normalizeAffectedPages(report, job.run, allowedSourceIds),
        comparisonMetrics: metricsFrom(metricSource, true),
      });
    } catch {
      // A malformed detail is isolated to that job. The overview and action
      // policy are built independently and must remain available.
      onNormalizationError?.();
    }
  }
  const byId = new Map<number, NormalizedDreamRunEntry>();
  for (const entry of entries) {
    if (entry.run.id !== null && !byId.has(entry.run.id)) byId.set(entry.run.id, entry);
  }
  return [...byId.values()].sort((left, right) => {
    const leftTime = new Date(left.run.finishedAt ?? left.run.startedAt ?? 0).getTime();
    const rightTime = new Date(right.run.finishedAt ?? right.run.startedAt ?? 0).getTime();
    return rightTime - leftTime || (right.run.id ?? 0) - (left.run.id ?? 0);
  });
}

function comparisonMetrics(current: NormalizedDreamRunEntry, previous: NormalizedDreamRunEntry | null): ControlDreamMetricComparison[] {
  if (!previous) return [];
  const prior = new Map(previous.comparisonMetrics.map((metric) => [metric.key, metric]));
  return current.comparisonMetrics.flatMap((metric) => {
    const previousMetric = prior.get(metric.key);
    if (!previousMetric) return [];
    return [{
      key: metric.key,
      label: metric.label,
      current: metric.value,
      previous: previousMetric.value,
      delta: metric.value - previousMetric.value,
    }];
  });
}

function findingsFor(run: ControlRun): ControlDreamFinding[] {
  const failed = run.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => phase.status === "fail")
    .map(({ phase, index }) => ({
      id: `failure:${phase.name}:${index}`,
      kind: "failure" as const,
      phase: phase.name,
      label: `${phase.label} 실패`,
      detail: phase.summary,
    }));
  const warned = run.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => phase.status === "warn")
    .map(({ phase, index }) => ({
      id: `warning:${phase.name}:${index}`,
      kind: "warning" as const,
      phase: phase.name,
      label: `${phase.label} 경고`,
      detail: phase.summary,
    }));
  const remediations = run.phases.flatMap((phase, phaseIndex) =>
    (phase.codes ?? []).map((code) => ({
      id: `remediation:${phase.name}:${phaseIndex}:${code}`,
      kind: "remediation" as const,
      phase: phase.name,
      label: PHASE_CODE_COPY[code].label,
      detail: PHASE_CODE_COPY[code].detail,
    })),
  );
  const metricFindings = run.phases.flatMap((phase, phaseIndex) => phase.metrics
    .filter((metric) => (metric.tone === "danger" || metric.tone === "warning") && metric.value !== 0)
    .sort((left, right) => (left.tone === right.tone ? 0 : left.tone === "danger" ? -1 : 1))
    .map((metric) => ({
      id: `metric:${phase.name}:${phaseIndex}:${metric.key}`,
      kind: "metric" as const,
      phase: phase.name,
      label: `${phase.label} · ${metric.label}`,
      detail: `기록값 ${metric.value}`,
    })));
  const totalDuration = run.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
  const durations = run.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => phase.durationMs > 0 && totalDuration > 0)
    .sort((left, right) => right.phase.durationMs - left.phase.durationMs || left.index - right.index)
    .map(({ phase, index }) => ({
      id: `duration:${phase.name}:${index}`,
      kind: "duration" as const,
      phase: phase.name,
      label: `${phase.label} 소요 시간`,
      detail: `전체 단계 시간의 ${Math.round((phase.durationMs / totalDuration) * 100)}% (${phase.durationMs}ms)`,
    }));
  return [...failed, ...warned, ...remediations, ...metricFindings, ...durations].slice(0, 5);
}

export function buildControlDreamDetails(
  entries: NormalizedDreamRunEntry[],
  snapshotGeneratedAt: string,
  staleNames: ReadonlySet<string> = new Set(),
): Map<number, ControlDreamRunDetail> {
  const details = new Map<number, ControlDreamRunDetail>();
  for (const [index, entry] of entries.entries()) {
    const id = entry.run.id;
    if (id === null) continue;
    const previous = entries.slice(index + 1).find((candidate) =>
      candidate.run.name === entry.run.name && candidate.run.sourceId === entry.run.sourceId,
    ) ?? null;
    details.set(id, {
      snapshotGeneratedAt,
      stale: staleNames.has(entry.run.name),
      run: entry.run,
      previousRun: previous?.run ?? null,
      comparison: { metrics: comparisonMetrics(entry, previous) },
      findings: findingsFor(entry.run),
      affectedPages: entry.affectedPages,
    });
  }
  return details;
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
  // Job error_text/error.message can contain an entire stack, SQL, paths, or
  // connector credentials. Status is the only allowlisted browser signal;
  // operators inspect server-side logs for the original failure.
  const error = normalizedStatus === "failed" || normalizedStatus === "dead"
    ? "작업이 실패했습니다. 서버 로그에서 세부 원인을 확인하세요."
    : null;
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
  const allVisible = !allowedSources || (
    sourceStatuses.length > 0
    && sourceStatuses.every((source) => allowedSources.has(source.id))
  );
  const jobIsVisible = (job: ControlJob) => job.sourceId
    ? !allowedSources || allowedSources.has(job.sourceId)
    : allVisible;
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
      : allVisible)
  );
  const latestTargetedRun = matchedTargetedRun ?? (snapshotTargetedIsVisible ? snapshotTargeted : null);
  const jobs = recentJobs.slice(0, 30);
  const dreamRuns = normalizeControlDreamRuns(runJobsValue, allowedSourceIds, allVisible).map((entry) => entry.run);
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
    dreamRuns,
    quality: {
      status: "fresh",
      recentJobs: "fresh",
      sourceDreamRuns: "fresh",
      globalDreamRuns: "fresh",
    },
  };
}

export function unavailableControlResponse(configured: boolean, message: string): ControlCenterResponse {
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
    dreamRuns: [],
    quality: {
      status: "unavailable",
      recentJobs: "unavailable",
      sourceDreamRuns: "unavailable",
      globalDreamRuns: "unavailable",
    },
  };
}
