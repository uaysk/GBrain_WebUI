import { Filter, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import type { ControlJob, ControlJobStatus, ControlSourceStatus } from "../../types";
import { Button } from "../ui/button";

export type ControlJobDateRange = "all" | "24h" | "7d" | "30d";

export interface ControlJobFiltersValue {
  sourceId: string;
  status: ControlJobStatus | "all";
  jobType: string;
  dateRange: ControlJobDateRange;
  failedOnly: boolean;
  uiLaunchedOnly: boolean;
}

export interface ControlJobFiltersProps {
  value: ControlJobFiltersValue;
  jobs: ControlJob[];
  sources: ControlSourceStatus[];
  onChange: (value: ControlJobFiltersValue) => void;
  resultCount?: number;
  className?: string;
}

export const DEFAULT_CONTROL_JOB_FILTERS: ControlJobFiltersValue = {
  sourceId: "all",
  status: "all",
  jobType: "all",
  dateRange: "all",
  failedOnly: false,
  uiLaunchedOnly: false,
};

const JOB_STATUSES: Array<{ value: ControlJobStatus; label: string }> = [
  { value: "active", label: "실행 중" },
  { value: "waiting", label: "대기" },
  { value: "waiting-children", label: "하위 작업 대기" },
  { value: "delayed", label: "지연" },
  { value: "paused", label: "일시 정지" },
  { value: "completed", label: "완료" },
  { value: "failed", label: "실패" },
  { value: "dead", label: "중단" },
  { value: "cancelled", label: "취소" },
  { value: "unknown", label: "알 수 없음" },
];

const VALID_STATUSES = new Set<ControlJobStatus>(JOB_STATUSES.map((item) => item.value));
const VALID_DATE_RANGES = new Set<ControlJobDateRange>(["all", "24h", "7d", "30d"]);

function jobTimestamp(job: ControlJob): number {
  const value = job.finishedAt ?? job.startedAt ?? job.createdAt;
  return value ? new Date(value).getTime() : 0;
}

function rangeStart(range: ControlJobDateRange, now: number): number {
  if (range === "24h") return now - 24 * 60 * 60 * 1_000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1_000;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1_000;
  return Number.NEGATIVE_INFINITY;
}

export function filterControlJobs(
  jobs: ControlJob[],
  value: ControlJobFiltersValue,
  uiLaunchedJobIds: readonly number[] = [],
  now = Date.now(),
): ControlJob[] {
  const uiLaunched = new Set(uiLaunchedJobIds);
  const oldest = rangeStart(value.dateRange, now);
  return jobs.filter((job) => {
    if (value.sourceId !== "all" && job.sourceId !== value.sourceId) return false;
    if (value.status !== "all" && job.status !== value.status) return false;
    if (value.jobType !== "all" && job.name !== value.jobType) return false;
    if (value.failedOnly && job.status !== "failed" && job.status !== "dead") return false;
    if (value.uiLaunchedOnly && !uiLaunched.has(job.id)) return false;
    if (jobTimestamp(job) < oldest) return false;
    return true;
  });
}

export function serializeControlJobFilters(
  value: ControlJobFiltersValue,
  base = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  const setOrDelete = (key: string, next: string, defaultValue: string) => {
    if (next === defaultValue) params.delete(key);
    else params.set(key, next);
  };
  setOrDelete("source", value.sourceId, "all");
  setOrDelete("status", value.status, "all");
  setOrDelete("type", value.jobType, "all");
  setOrDelete("range", value.dateRange, "all");
  if (value.failedOnly) params.set("failed", "1");
  else params.delete("failed");
  if (value.uiLaunchedOnly) params.set("ui", "1");
  else params.delete("ui");
  return params;
}

export function parseControlJobFilters(params: URLSearchParams): ControlJobFiltersValue {
  const status = params.get("status");
  const dateRange = params.get("range");
  return {
    sourceId: params.get("source") || "all",
    status: status && VALID_STATUSES.has(status as ControlJobStatus) ? status as ControlJobStatus : "all",
    jobType: params.get("type") || "all",
    dateRange: dateRange && VALID_DATE_RANGES.has(dateRange as ControlJobDateRange)
      ? dateRange as ControlJobDateRange
      : "all",
    failedOnly: params.get("failed") === "1",
    uiLaunchedOnly: params.get("ui") === "1",
  };
}

export function hasActiveControlJobFilters(value: ControlJobFiltersValue): boolean {
  return value.sourceId !== "all"
    || value.status !== "all"
    || value.jobType !== "all"
    || value.dateRange !== "all"
    || value.failedOnly
    || value.uiLaunchedOnly;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return <label className="min-w-0">
    <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.1em] text-zinc-600">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full min-w-32 rounded-md border-0 bg-black/25 px-2.5 text-[11px] text-zinc-300 outline-none focus:ring-1 focus:ring-cyan-500"
    >{children}</select>
  </label>;
}

export function ControlJobFilters({
  value,
  jobs,
  sources,
  onChange,
  resultCount,
  className = "",
}: ControlJobFiltersProps) {
  const jobTypes = useMemo(() => {
    const names = new Map<string, string>();
    for (const job of jobs) if (!names.has(job.name)) names.set(job.name, job.label);
    return [...names].sort((left, right) => left[1].localeCompare(right[1], "ko"));
  }, [jobs]);
  const active = hasActiveControlJobFilters(value);
  const update = <Key extends keyof ControlJobFiltersValue>(key: Key, next: ControlJobFiltersValue[Key]) => {
    onChange({ ...value, [key]: next });
  };

  return <section
    className={`rounded-lg bg-black/15 px-3 py-3 ${className}`}
    aria-label="Job 필터"
    data-testid="control-job-filters"
  >
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-3.5 text-zinc-500" aria-hidden="true" />
      <strong className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Job 필터</strong>
      {resultCount !== undefined && <span className="rounded bg-zinc-800 px-2 py-1 font-mono text-[9px] text-zinc-400">
        {resultCount.toLocaleString()} / {jobs.length.toLocaleString()}
      </span>}
      {active && <Button
        type="button"
        variant="ghost"
        className="ml-auto h-7 px-2 text-[10px]"
        onClick={() => onChange(DEFAULT_CONTROL_JOB_FILTERS)}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        초기화
      </Button>}
    </div>

    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <FilterSelect label="Source" value={value.sourceId} onChange={(next) => update("sourceId", next)}>
        <option value="all">모든 Source</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </FilterSelect>
      <FilterSelect
        label="상태"
        value={value.status}
        onChange={(next) => onChange({
          ...value,
          status: next as ControlJobStatus | "all",
          failedOnly: next === "all" ? value.failedOnly : false,
        })}
      >
        <option value="all">모든 상태</option>
        {JOB_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
      </FilterSelect>
      <FilterSelect label="작업 유형" value={value.jobType} onChange={(next) => update("jobType", next)}>
        <option value="all">모든 유형</option>
        {jobTypes.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="기간" value={value.dateRange} onChange={(next) => update("dateRange", next as ControlJobDateRange)}>
        <option value="all">전체 기간</option>
        <option value="24h">최근 24시간</option>
        <option value="7d">최근 7일</option>
        <option value="30d">최근 30일</option>
      </FilterSelect>
    </div>

    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-400">
        <input
          type="checkbox"
          checked={value.failedOnly}
          onChange={(event) => onChange({
            ...value,
            failedOnly: event.target.checked,
            status: event.target.checked ? "all" : value.status,
          })}
          className="size-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-600 accent-cyan-600 focus:ring-cyan-500"
        />
        실패·중단만
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-400">
        <input
          type="checkbox"
          checked={value.uiLaunchedOnly}
          onChange={(event) => update("uiLaunchedOnly", event.target.checked)}
          className="size-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-600 accent-cyan-600 focus:ring-cyan-500"
        />
        UI에서 실행한 작업만
      </label>
    </div>
  </section>;
}
