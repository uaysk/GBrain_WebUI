import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  BarChart3,
  Bell,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Eye,
  Layers3,
  Play,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import type {
  ControlActionResult,
  ControlCenterResponse,
  ControlJob,
  ControlJobProgress,
  ControlMetric,
  ControlPhase,
  ControlRecentJobCounts,
  ControlRun,
  ControlSourceStatus,
} from "../../types";
import {
  buildControlActionPreview,
  buildControlInbox,
  type ControlActionPreviewTarget,
} from "../../control/insights";
import { useControlActions, type ControlActionFailure } from "../../hooks/useControlActions";
import { useControlCenter } from "../../hooks/useControlCenter";
import {
  useControlExperience,
  type ControlActivityRecord,
} from "../../hooks/useControlExperience";
import { Button } from "../ui/button";
import { ActionOutcomeDiff } from "./ActionOutcomeDiff";
import { ActivityDrawer } from "./ActivityDrawer";
import {
  ControlActionDialog,
  createControlActionRequest,
  type ControlActionIntent,
} from "./ControlActionDialog";
import { ControlCommandPalette } from "./ControlCommandPalette";
import {
  ControlJobFilters,
  DEFAULT_CONTROL_JOB_FILTERS,
  filterControlJobs,
  parseControlJobFilters,
  serializeControlJobFilters,
  type ControlJobFiltersValue,
} from "./ControlJobFilters";
import { ControlTrends } from "./ControlTrends";
import { JobDependencyGraph } from "./JobDependencyGraph";
import {
  OperationsInbox,
  type OperationsAttentionItem,
} from "./OperationsInbox";
import { SourceDetailDrawer, type SourceDetailAction } from "./SourceDetailDrawer";
import { StatusBadge } from "./StatusBadge";

function formatDuration(value: number): string {
  if (!value) return "0초";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}초`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}분 ${seconds}초`;
}

function formatDate(value: string | null): string {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "medium" });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function metricClass(metric: ControlMetric): string {
  if (metric.tone === "good") return "text-emerald-300";
  if (metric.tone === "warning") return "text-amber-300";
  if (metric.tone === "danger") return "text-red-300";
  return "text-zinc-200";
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-zinc-900/70 ${className}`}>{children}</section>;
}

function OverviewCard({ icon: Icon, label, value, detail, tone = "neutral" }: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const iconClass = tone === "good" ? "bg-emerald-950 text-emerald-300"
    : tone === "warning" ? "bg-amber-950 text-amber-300"
      : tone === "danger" ? "bg-red-950 text-red-300"
        : "bg-zinc-800 text-zinc-300";
  return <Panel className="min-w-0 p-4">
    <div className="flex items-start gap-3">
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconClass}`}><Icon className="size-4" /></div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
        <div className="mt-1 truncate text-lg font-semibold text-zinc-100" title={value}>{value}</div>
        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{detail}</div>
      </div>
    </div>
  </Panel>;
}

function AvailabilityBanner({ data }: { data: ControlCenterResponse }) {
  if (data.availability.connected && !data.availability.message) return null;
  const configured = data.availability.configured;
  return <div
    className={`flex items-start gap-3 rounded-xl px-4 py-3 ${configured ? "bg-amber-950/55 text-amber-200" : "bg-zinc-900 text-zinc-300"}`}
    role="status"
    data-testid="control-availability"
  >
    <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${configured ? "text-amber-400" : "text-zinc-500"}`} />
    <div>
      <div className="text-xs font-medium">{configured ? "Control MCP 연결 상태를 확인하세요" : "Control Center 연결이 필요합니다"}</div>
      <p className="mt-1 text-[11px] leading-relaxed opacity-75">
        {data.availability.message}
        {!configured && " 서버 환경에 GBRAIN_CONTROL_MCP_URL과 서버 전용 admin-scope token을 설정하면 Dream과 Jobs 상태가 표시됩니다."}
      </p>
    </div>
  </div>;
}

function Metrics({ metrics, emptyText = "이번 실행에서 집계된 변경이 없습니다." }: { metrics: ControlMetric[]; emptyText?: string }) {
  if (!metrics.length) return <div className="rounded-lg bg-black/15 px-3 py-4 text-center text-[11px] text-zinc-600">{emptyText}</div>;
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
    {metrics.map((metric) => <div key={metric.key} className="rounded-lg bg-black/20 px-3 py-2.5">
      <div className={`font-mono text-lg font-semibold ${metricClass(metric)}`}>{formatNumber(metric.value)}</div>
      <div className="mt-0.5 text-[10px] text-zinc-500">{metric.label}</div>
    </div>)}
  </div>;
}

function PhaseTimeline({ phases }: { phases: ControlPhase[] }) {
  const maxDuration = Math.max(...phases.map((phase) => phase.durationMs), 1);
  if (!phases.length) return <div className="rounded-lg bg-black/15 px-4 py-8 text-center text-xs text-zinc-600">이 실행의 단계별 보고서는 보존되지 않았습니다.</div>;
  return <ol className="space-y-2" aria-label="Dream 단계별 실행 결과">
    {phases.map((phase, index) => {
      const width = phase.durationMs ? Math.max(3, Math.round((phase.durationMs / maxDuration) * 100)) : 0;
      return <li key={`${phase.name}-${index}`}>
        <details className="group rounded-lg bg-black/20 open:bg-black/30">
          <summary className="list-none cursor-pointer px-3 py-2.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500">
            <div className="flex items-center gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-zinc-800 font-mono text-[10px] text-zinc-500">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-[11px] font-medium text-zinc-200">{phase.label}</strong>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">{formatDuration(phase.durationMs)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800" aria-label={`${phase.label} 소요 시간 ${formatDuration(phase.durationMs)}`}>
                  <div className={`h-full rounded-full ${
                    phase.status === "ok" ? "bg-emerald-500" : phase.status === "warn" ? "bg-amber-500"
                      : phase.status === "fail" ? "bg-red-500" : phase.status === "running" ? "bg-cyan-500" : "bg-zinc-600"
                  }`} style={{ width: `${width}%` }} />
                </div>
              </div>
              <StatusBadge status={phase.status} />
            </div>
          </summary>
          <div className="px-11 pb-3">
            <p className="text-[11px] leading-relaxed text-zinc-400">{phase.summary}</p>
            {!!phase.metrics.length && <div className="mt-2 flex flex-wrap gap-1.5">
              {phase.metrics.map((metric) => <span key={metric.key} className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">
                {metric.label} <b className={`ml-1 font-mono font-medium ${metricClass(metric)}`}>{formatNumber(metric.value)}</b>
              </span>)}
            </div>}
            {!!phase.warnings.length && <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-amber-300">
              {phase.warnings.map((warning) => <li key={warning} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{warning}</li>)}
            </ul>}
          </div>
        </details>
      </li>;
    })}
  </ol>;
}

function RunPanel({ title, run }: { title: string; run: ControlRun | null }) {
  const counts = useMemo(() => {
    const value = { ok: 0, warn: 0, fail: 0, skipped: 0, running: 0, unknown: 0 };
    for (const phase of run?.phases ?? []) value[phase.status] += 1;
    return value;
  }, [run]);
  if (!run) return <Panel className="p-4">
    <h2 className="text-xs font-semibold text-zinc-200">{title}</h2>
    <div className="mt-3 rounded-lg bg-black/15 px-4 py-8 text-center text-xs text-zinc-600">실행 기록이 없습니다.</div>
  </Panel>;
  const jobBadgeLabel = run.jobStatus === "completed" ? "Job 완료" : undefined;
  const reportBadgeLabel = run.reportStatus === "warn" ? "Report 주의" : run.reportStatus === "ok" ? "Report 정상" : undefined;
  return <Panel className="overflow-hidden">
    <header className="flex flex-wrap items-start gap-3 bg-zinc-900 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">{run.label}</h2>
          <StatusBadge status={run.jobStatus} label={jobBadgeLabel} />
          <StatusBadge status={run.reportStatus} label={reportBadgeLabel} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          <span>{run.sourceId ? `Source ${run.sourceId}` : "Brain-wide"}</span>
          <span>{formatDate(run.finishedAt)}</span>
          <span>{formatDuration(run.durationMs)}</span>
        </div>
      </div>
      {!!run.phases.length && <div className="flex max-w-72 flex-wrap justify-end gap-1 text-center text-[9px]">
        <span className="rounded bg-emerald-950/60 px-1.5 py-1 text-emerald-300">{counts.ok} 정상</span>
        <span className="rounded bg-amber-950/60 px-1.5 py-1 text-amber-300">{counts.warn} 주의</span>
        <span className="rounded bg-red-950/60 px-1.5 py-1 text-red-300">{counts.fail} 실패</span>
        <span className="rounded bg-zinc-800 px-1.5 py-1 text-zinc-400">{counts.skipped} 건너뜀</span>
        <span className="rounded bg-cyan-950/60 px-1.5 py-1 text-cyan-300">{counts.running} 실행 중</span>
        <span className="rounded bg-zinc-800 px-1.5 py-1 text-zinc-500">{counts.unknown} 기타</span>
      </div>}
    </header>
    <div className="space-y-5 p-4">
      {!!run.warnings.length && <div className="rounded-lg bg-amber-950/35 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300"><AlertTriangle className="size-3" />확인할 항목</div>
        <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-amber-200/75">
          {run.warnings.slice(0, 4).map((warning) => <li key={warning}>• {warning}</li>)}
        </ul>
      </div>}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">실행 영향</h3>
        <Metrics metrics={run.impacts} />
      </div>
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">단계 타임라인</h3>
        <PhaseTimeline phases={run.phases} />
      </div>
    </div>
  </Panel>;
}

const OPEN_JOB_STATUSES = new Set(["waiting", "waiting-children", "active", "delayed", "paused"]);

function sourceHasOpenJob(sourceId: string, jobs: ControlJob[], names: string[]): boolean {
  return jobs.some((job) =>
    job.sourceId === sourceId
    && names.includes(job.name)
    && OPEN_JOB_STATUSES.has(job.status));
}

function SourceCard({ source, jobs, managementEnabled, executing, onAction, onView }: {
  source: ControlSourceStatus;
  jobs: ControlJob[];
  managementEnabled: boolean;
  executing: boolean;
  onAction: (intent: ControlActionIntent) => void;
  onView: (source: ControlSourceStatus) => void;
}) {
  const tone = !source.syncEnabled ? "text-zinc-500"
    : source.stalenessClass === "fresh" ? "text-emerald-300"
      : source.stalenessClass === "stale" ? "text-red-300" : "text-amber-300";
  const stateLabel = source.syncEnabled ? source.stalenessClass : "sync off";
  const backfillTotal = source.backfillActive + source.backfillQueued;
  const syncBusy = sourceHasOpenJob(source.id, jobs, ["sync", "autopilot-cycle"]);
  const embeddingBusy = backfillTotal > 0 || sourceHasOpenJob(source.id, jobs, ["embed", "embed-backfill", "autopilot-cycle"]);
  const syncDisabled = !managementEnabled || executing || !source.syncEnabled || syncBusy;
  const embeddingDisabled = !managementEnabled || executing || source.chunksUnembedded <= 0 || embeddingBusy;
  const syncTitle = !managementEnabled ? "직접 실행이 비활성화되어 있습니다."
    : !source.syncEnabled ? "이 Source는 동기화가 비활성화되어 있습니다."
      : syncBusy ? "이 Source의 동기화 또는 Dream 작업이 이미 진행 중입니다." : "Source 동기화 확인 창 열기";
  const embeddingTitle = !managementEnabled ? "직접 실행이 비활성화되어 있습니다."
    : source.chunksUnembedded <= 0 ? "갱신할 누락 Embedding이 없습니다."
      : embeddingBusy ? "이 Source의 Embedding 작업이 이미 진행 중입니다." : "Embedding 갱신 확인 창 열기";
  return <div className="rounded-lg bg-black/20 p-3">
    <div className="flex items-start gap-2">
      <DatabaseZap className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><strong className="truncate text-xs font-medium text-zinc-200">{source.name}</strong><span className={`ml-auto text-[10px] ${tone}`}>{stateLabel}</span></div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-label={`${source.name} Embedding 적용률`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={source.embeddingCoveragePct}
        >
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${source.embeddingCoveragePct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500">
          <span>{formatNumber(source.pages)} pages · {formatNumber(source.chunksTotal)} chunks</span>
          <span>{source.embeddingCoveragePct.toFixed(1)}% embedded</span>
        </div>
        <div className="mt-1 text-[10px] text-zinc-600">최근 sync {formatDate(source.lastSyncAt)}</div>
        {backfillTotal > 0 && <div className="mt-2 flex items-center gap-2 rounded bg-zinc-900 px-2 py-1.5">
          <Workflow className="size-3 shrink-0 text-cyan-400" />
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-zinc-500">Backfill</span>
          <div
            className="ml-auto flex h-1 w-16 overflow-hidden rounded-full bg-zinc-800"
            aria-label={`Backfill 실행 ${source.backfillActive}, 대기 ${source.backfillQueued}`}
          >
            <span className="h-full bg-cyan-500" style={{ width: `${(source.backfillActive / backfillTotal) * 100}%` }} />
            <span className="h-full bg-sky-800" style={{ width: `${(source.backfillQueued / backfillTotal) * 100}%` }} />
          </div>
          <span className="font-mono text-[9px] text-zinc-500">{source.backfillActive} 실행 · {source.backfillQueued} 대기</span>
        </div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => onView(source)}
            className="h-7 text-[10px]"
            aria-label={`${source.name} 상세 보기`}
          >
            <Eye className="size-3" aria-hidden="true" />
            상세
          </Button>
          <Button
            onClick={() => onAction({ action: "source-sync", source })}
            disabled={syncDisabled}
            title={syncTitle}
            className="h-7 text-[10px]"
          >
            <RefreshCw className="size-3" />
            Source 동기화
          </Button>
          <Button
            onClick={() => onAction({ action: "embedding-refresh", source })}
            disabled={embeddingDisabled}
            title={embeddingTitle}
            className="h-7 text-[10px]"
          >
            <DatabaseZap className="size-3" />
            Embedding 갱신
          </Button>
        </div>
      </div>
    </div>
  </div>;
}

const JOB_COUNT_ITEMS: Array<{ key: keyof Omit<ControlRecentJobCounts, "sampleSize">; label: string; className: string }> = [
  { key: "completed", label: "완료", className: "bg-emerald-500" },
  { key: "active", label: "실행", className: "bg-cyan-500" },
  { key: "waiting", label: "대기", className: "bg-sky-500" },
  { key: "waitingChildren", label: "하위 작업", className: "bg-sky-700" },
  { key: "paused", label: "정지", className: "bg-zinc-500" },
  { key: "delayed", label: "지연", className: "bg-amber-500" },
  { key: "failed", label: "실패", className: "bg-red-500" },
  { key: "dead", label: "중단", className: "bg-red-800" },
  { key: "cancelled", label: "취소", className: "bg-zinc-600" },
  { key: "unknown", label: "기타", className: "bg-zinc-700" },
];

function JobDistribution({ counts }: { counts: ControlRecentJobCounts }) {
  const total = Math.max(1, counts.sampleSize);
  return <div>
    <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800" aria-label={`최근 ${counts.sampleSize}개 작업 상태 분포`}>
      {JOB_COUNT_ITEMS.map((item) => counts[item.key] > 0 && <div
        key={item.key}
        className={item.className}
        style={{ width: `${(counts[item.key] / total) * 100}%` }}
        title={`${item.label} ${counts[item.key]}`}
      />)}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {JOB_COUNT_ITEMS.map((item) => <span key={item.key} className="flex items-center gap-1 text-[10px] text-zinc-500">
        <span className={`size-1.5 rounded-full ${item.className}`} />{item.label} <b className="font-mono font-normal text-zinc-300">{counts[item.key]}</b>
      </span>)}
    </div>
  </div>;
}

function JobProgress({ progress }: { progress: ControlJobProgress }) {
  const phaseLabel = progress.phase ? progress.phase.replaceAll("_", " ") : "진행 상태";
  const countLabel = progress.completed !== null && progress.total !== null
    ? `${formatNumber(progress.completed)} / ${formatNumber(progress.total)}`
    : progress.percent !== null ? `${progress.percent.toFixed(0)}%` : null;
  return <div className="rounded-lg bg-cyan-950/25 px-3 py-2.5" data-testid="control-job-progress">
    <div className="flex items-center gap-2 text-[10px]">
      <Activity className="size-3 shrink-0 text-cyan-400" />
      <strong className="font-medium text-cyan-200">{phaseLabel}</strong>
      {countLabel && <span className="ml-auto font-mono text-cyan-300">{countLabel}</span>}
    </div>
    {progress.percent !== null && <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
      role="progressbar"
      aria-label={`${phaseLabel} 진행률`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent}
    >
      <div className="h-full rounded-full bg-cyan-500" style={{ width: `${progress.percent}%` }} />
    </div>}
    {progress.message && <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">{progress.message}</p>}
  </div>;
}

function JobList({ jobs, selectedId, onSelect }: { jobs: ControlJob[]; selectedId: number | null; onSelect: (job: ControlJob) => void }) {
  if (!jobs.length) return <div className="rounded-lg bg-black/15 px-4 py-8 text-center text-xs text-zinc-600">최근 작업이 없습니다.</div>;
  return <ul className="max-h-[640px] space-y-1.5 overflow-y-auto pr-1" aria-label="최근 GBrain 작업">
    {jobs.map((job) => <li key={job.id}>
      <button
        type="button"
        aria-pressed={selectedId === job.id}
        onClick={() => onSelect(job)}
        className={`block w-full rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 ${
          selectedId === job.id ? "bg-zinc-700/80" : "bg-black/20 hover:bg-zinc-800"
        }`}
      >
        <div className="flex items-center gap-2">
          <Workflow className="size-3.5 shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{job.label}</span>
          <StatusBadge status={job.status} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-5 text-[10px] text-zinc-600">
          <span>#{job.id}</span>
          <span>{job.sourceId ?? "brain-wide"}</span>
          <span>{formatDuration(job.durationMs)}</span>
          <span>{formatDate(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
        </div>
        {job.progress?.percent !== null && job.progress?.percent !== undefined && <div className="mt-2 ml-5 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${job.progress.percent}%` }} />
        </div>}
      </button>
    </li>)}
  </ul>;
}

function JobDetail({ job, jobs, managementEnabled, executing, onAction, onSelectJob }: {
  job: ControlJob | null;
  jobs: ControlJob[];
  managementEnabled: boolean;
  executing: boolean;
  onAction: (intent: ControlActionIntent) => void;
  onSelectJob: (job: ControlJob) => void;
}) {
  if (!job) return <div className="grid min-h-48 place-items-center rounded-lg bg-black/15 px-5 text-center text-xs text-zinc-600">작업을 선택하면 실행 결과를 시각적으로 확인할 수 있습니다.</div>;
  const retryable = Boolean(job.sourceId)
    && ["sync", "embed"].includes(job.name)
    && ["failed", "dead"].includes(job.status);
  const cancellable = Boolean(job.sourceId)
    && ["sync", "embed", "autopilot-cycle"].includes(job.name)
    && ["waiting", "delayed"].includes(job.status);
  return <div className="rounded-lg bg-black/20 p-4" data-testid="control-job-detail">
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">Job #{job.id}</div>
        <h3 className="mt-1 text-sm font-semibold text-zinc-100">{job.label}</h3>
        <div className="mt-1 text-[10px] text-zinc-500">{job.sourceId ?? "Brain-wide"} · queue {job.queue}</div>
      </div>
      <StatusBadge status={job.status} />
      {job.run && <StatusBadge
        status={job.run.reportStatus}
        label={job.run.reportStatus === "warn" ? "Report 주의" : job.run.reportStatus === "ok" ? "Report 정상" : undefined}
      />}
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
      <div className="rounded bg-zinc-900 px-2.5 py-2"><dt className="text-zinc-600">소요 시간</dt><dd className="mt-1 font-mono text-zinc-300">{formatDuration(job.durationMs)}</dd></div>
      <div className="rounded bg-zinc-900 px-2.5 py-2"><dt className="text-zinc-600">시도 횟수</dt><dd className="mt-1 font-mono text-zinc-300">{job.attemptsMade} / {job.maxAttempts || "—"}</dd></div>
      <div className="rounded bg-zinc-900 px-2.5 py-2"><dt className="text-zinc-600">시작</dt><dd className="mt-1 text-zinc-300">{formatDate(job.startedAt)}</dd></div>
      <div className="rounded bg-zinc-900 px-2.5 py-2"><dt className="text-zinc-600">종료</dt><dd className="mt-1 text-zinc-300">{formatDate(job.finishedAt)}</dd></div>
    </dl>
    {job.progress && <div className="mt-3"><JobProgress progress={job.progress} /></div>}
    {job.error && <div className="mt-3 rounded bg-red-950/40 px-3 py-2 text-[10px] leading-relaxed text-red-300">{job.error}</div>}
    <JobDependencyGraph
      job={job}
      jobs={jobs}
      parentJob={job.parentId ? jobs.find((candidate) => candidate.id === job.parentId) ?? null : null}
      childJobs={jobs.filter((candidate) => candidate.parentId === job.id)}
      onSelectJob={onSelectJob}
      className="mt-3"
    />
    {(retryable || cancellable) && <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
      {retryable && <Button
        onClick={() => onAction({ action: "job-retry", job })}
        disabled={!managementEnabled || executing}
        title={managementEnabled ? "작업 재시도 확인 창 열기" : "직접 실행이 비활성화되어 있습니다."}
      >
        <RotateCcw className="size-3.5" />
        작업 재시도
      </Button>}
      {cancellable && <Button
        variant="danger"
        onClick={() => onAction({ action: "job-cancel", job })}
        disabled={!managementEnabled || executing}
        title={managementEnabled ? "대기 작업 취소 확인 창 열기" : "직접 실행이 비활성화되어 있습니다."}
      >
        <Ban className="size-3.5" />
        대기 작업 취소
      </Button>}
    </div>}
    {job.run && <div className="mt-4 space-y-4">
      <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">변화량</div><Metrics metrics={job.run.impacts} /></div>
      <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">단계 결과</div><PhaseTimeline phases={job.run.phases} /></div>
    </div>}
  </div>;
}

function ActionReceipt({ result, record, onSelectJob }: {
  result: ControlActionResult;
  record?: ControlActivityRecord;
  onSelectJob: (jobId: number) => void;
}) {
  const pending = result.outcome === "pending-verification";
  const Icon = pending ? AlertTriangle : CheckCircle2;
  return <div
    className={`flex flex-wrap items-start gap-3 rounded-xl px-4 py-3 ${
      pending ? "bg-amber-950/50 text-amber-200" : "bg-emerald-950/45 text-emerald-200"
    }`}
    role="status"
    aria-live="polite"
    data-testid="control-action-receipt"
  >
    <Icon className="mt-0.5 size-4 shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span>{pending ? "접수 여부 확인 필요" : "관리 작업 접수 완료"}</span>
        {result.replayed && <span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">동일 요청 재확인</span>}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed opacity-80">{result.message}</p>
      {result.job && <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] opacity-75">Job #{result.job.id}</span>
        <StatusBadge status={result.job.status} />
        <Button
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={() => onSelectJob(result.job!.id)}
        >
          Job 보기
        </Button>
      </div>}
      {record && <div className="mt-3"><ActionOutcomeDiff record={record} /></div>}
    </div>
  </div>;
}

function previewTarget(intent: ControlActionIntent): ControlActionPreviewTarget {
  if (intent.source) return { action: intent.action, sourceId: intent.source.id };
  return { action: intent.action, jobId: intent.job.id };
}

function attentionActionLabel(action: string | null, pendingVerification: boolean): string | undefined {
  if (pendingVerification) return "상태 갱신";
  if (action === "job-retry") return "안전하게 재시도";
  if (action === "job-cancel") return "취소 검토";
  if (action === "source-sync") return "동기화 검토";
  if (action === "embedding-refresh") return "Embedding 갱신";
  if (action === "quick-dream") return "Quick Dream 검토";
  return undefined;
}

export function ControlCenter() {
  const { data, loading, refreshing, error, refresh } = useControlCenter();
  const actions = useControlActions();
  const experience = useControlExperience(data);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [pendingJobId, setPendingJobId] = useState<number | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sourceDetailId, setSourceDetailId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [actionIntent, setActionIntent] = useState<ControlActionIntent | null>(null);
  const [jobFilters, setJobFilters] = useState<ControlJobFiltersValue>(() => (
    typeof window === "undefined"
      ? DEFAULT_CONTROL_JOB_FILTERS
      : parseControlJobFilters(new URLSearchParams(window.location.search))
  ));
  const jobsPanelRef = useRef<HTMLDivElement>(null);
  const filteredJobs = useMemo(() => data
    ? filterControlJobs(
      data.jobs,
      jobFilters,
      [...experience.uiLaunchedJobIds],
      Number.isFinite(Date.parse(data.generatedAt)) ? Date.parse(data.generatedAt) : Date.now(),
    )
    : [], [data, experience.uiLaunchedJobIds, jobFilters]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.search = serializeControlJobFilters(jobFilters, url.searchParams).toString();
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [jobFilters]);

  useEffect(() => {
    if (!data?.jobs.length) {
      setSelectedJobId(null);
      return;
    }
    if (pendingJobId !== null && data.jobs.some((job) => job.id === pendingJobId)) {
      setJobFilters(DEFAULT_CONTROL_JOB_FILTERS);
      setSelectedJobId(pendingJobId);
      setPendingJobId(null);
      return;
    }
    if (!data.jobs.some((job) => job.id === selectedJobId)) setSelectedJobId(data.jobs[0].id);
  }, [data?.jobs, pendingJobId, selectedJobId]);
  useEffect(() => {
    if (!filteredJobs.length) {
      setSelectedJobId(null);
      return;
    }
    if (!filteredJobs.some((job) => job.id === selectedJobId)) setSelectedJobId(filteredJobs[0].id);
  }, [filteredJobs, selectedJobId]);
  useEffect(() => {
    if (!data?.sources.length) {
      setSelectedSourceId("");
      return;
    }
    const selectable = data.sources.filter((source) => source.syncEnabled);
    const choices = selectable.length ? selectable : data.sources;
    if (!choices.some((source) => source.id === selectedSourceId)) setSelectedSourceId(choices[0].id);
  }, [data?.sources, selectedSourceId]);
  const selectedJob = data?.jobs.find((job) => job.id === selectedJobId) ?? null;
  const enabledSources = data?.sources.filter((source) => source.syncEnabled) ?? [];
  const selectedSource = data?.sources.find((source) => source.id === selectedSourceId) ?? null;
  const freshSources = enabledSources.filter((source) => source.stalenessClass === "fresh").length;
  const unhealthyJobs = (data?.recentJobCounts.failed ?? 0) + (data?.recentJobCounts.dead ?? 0);
  const quickDreamBusy = selectedSource
    ? sourceHasOpenJob(selectedSource.id, data?.jobs ?? [], ["autopilot-cycle"])
    : false;
  const openAction = (intent: ControlActionIntent) => {
    actions.clear();
    setSourceDetailId(null);
    setActivityOpen(false);
    setActionIntent(intent);
  };
  const closeAction = () => {
    if (actions.executing) return;
    actions.clear();
    setActionIntent(null);
  };
  const selectJobAndReveal = (jobId: number) => {
    setJobFilters(DEFAULT_CONTROL_JOB_FILTERS);
    if (data?.jobs.some((job) => job.id === jobId)) setSelectedJobId(jobId);
    else setPendingJobId(jobId);
    window.requestAnimationFrame(() => jobsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const actionPreview = useMemo(() => (
    data && actionIntent ? buildControlActionPreview(data, previewTarget(actionIntent)) : null
  ), [actionIntent, data]);
  const pendingVerifications = experience.activity
    .filter((record) => record.result.outcome === "pending-verification")
    .map((record) => ({
      actionId: record.id,
      action: record.result.action,
      createdAt: record.recordedAt,
      sourceId: record.sourceId,
      jobId: record.result.job?.id ?? null,
    }));
  const rawInboxItems = useMemo(() => data
    ? buildControlInbox(data, { pendingVerifications })
    : [], [data, pendingVerifications]);
  const inboxItems = useMemo<OperationsAttentionItem[]>(() => rawInboxItems.map((item) => {
    const pendingVerification = item.kind === "pending-verification";
    const actionLabel = attentionActionLabel(item.action, pendingVerification);
    return {
      id: item.id,
      priority: item.severity,
      title: item.title,
      description: item.message,
      status: item.jobId ? data?.jobs.find((job) => job.id === item.jobId)?.status : undefined,
      sourceId: item.sourceId ?? undefined,
      jobId: item.jobId ?? undefined,
      value: item.ageMs && item.ageMs > 0 ? formatDuration(item.ageMs) : undefined,
      actionLabel,
      actionVariant: item.severity === "critical" ? "danger" : item.severity === "high" ? "primary" : "default",
      viewLabel: item.jobId ? "Job 상세" : item.sourceId ? "Source 상세" : undefined,
      actionDisabled: !pendingVerification && Boolean(actionLabel) && (!data?.management.enabled || actions.executing),
      actionDisabledReason: !data?.management.enabled
        ? "직접 실행이 비활성화되어 있습니다."
        : actions.executing ? "다른 관리 요청을 처리하고 있습니다." : undefined,
    };
  }), [actions.executing, data, rawInboxItems]);
  const sourceDetail = data?.sources.find((source) => source.id === sourceDetailId) ?? null;
  const currentActivityRecord = actions.result
    ? experience.activity.find((record) => record.id === actions.result!.actionId)
    : undefined;

  const executeAction = async (request: Parameters<typeof actions.execute>[0]) => {
    const intent = actionIntent;
    if (!intent) return;
    const result = await actions.execute(request);
    if (!result) return;
    experience.recordAction(result, intent);
    setActionIntent(null);
    await refresh(false);
    if (result.job) setPendingJobId(result.job.id);
  };

  const recoverAction = async (failure: ControlActionFailure) => {
    if (!actionIntent) return;
    if (failure.recoveryAction === "reauthenticate") {
      window.location.reload();
      return;
    }
    if (failure.recoveryAction === "refresh") {
      await refresh(true);
      actions.clear();
      return;
    }
    if (failure.recoveryAction === "inspect-jobs") {
      const sourceId = actionIntent.source?.id ?? actionIntent.job?.sourceId;
      const target = actionIntent.job
        ?? data?.jobs.find((job) => job.sourceId === sourceId && OPEN_JOB_STATUSES.has(job.status));
      closeAction();
      if (target) selectJobAndReveal(target.id);
      return;
    }
    await executeAction(createControlActionRequest(actionIntent));
  };

  const handleInboxAction = async (item: OperationsAttentionItem) => {
    const insight = rawInboxItems.find((candidate) => candidate.id === item.id);
    if (!insight) return;
    if (insight.kind === "pending-verification") {
      await refresh(true);
      return;
    }
    if (insight.jobId && (insight.action === "job-retry" || insight.action === "job-cancel")) {
      const job = data?.jobs.find((candidate) => candidate.id === insight.jobId);
      if (job) openAction({ action: insight.action, job });
      return;
    }
    if (insight.sourceId && insight.action && ["quick-dream", "source-sync", "embedding-refresh"].includes(insight.action)) {
      const source = data?.sources.find((candidate) => candidate.id === insight.sourceId);
      if (source) openAction({ action: insight.action as SourceDetailAction, source });
    }
  };

  const handleInboxView = (item: OperationsAttentionItem) => {
    if (item.jobId) selectJobAndReveal(item.jobId);
    else if (item.sourceId) setSourceDetailId(item.sourceId);
  };

  return <section
    className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#080808]"
    style={{ contain: "layout paint" }}
    data-testid="control-center"
  >
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-500"><ServerCog className="size-3.5" />GBrain Operations</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">Control Center</h2>
          <p className="mt-1 text-xs text-zinc-500">Dream cycle, source와 background job을 구조화된 상태로 확인합니다.</p>
        </div>
        <div className="flex max-w-full flex-col items-end">
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            {data && <label className="sr-only" htmlFor="control-source-select">Quick Dream Source</label>}
            {data && <select
              id="control-source-select"
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.target.value)}
              className="h-8 max-w-52 rounded-md border-0 bg-zinc-900 px-2.5 text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-40"
              disabled={!enabledSources.length || actions.executing}
              aria-label="Quick Dream Source"
            >
              {enabledSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>}
            {data && <Button
              variant="primary"
              onClick={() => selectedSource && openAction({ action: "quick-dream", source: selectedSource })}
              disabled={!data.management.enabled || !selectedSource || actions.executing || quickDreamBusy}
              title={!data.management.enabled ? "직접 실행이 비활성화되어 있습니다."
                : quickDreamBusy ? "이 Source의 Quick Dream이 이미 진행 중입니다." : "Quick Dream 확인 창 열기"}
            >
              <Play className="size-3.5" />
              Quick Dream
            </Button>}
            {data && <ControlCommandPalette
              sources={data.sources}
              jobs={data.jobs}
              onSelectSource={(source) => setSourceDetailId(source.id)}
              onSelectJob={(job) => selectJobAndReveal(job.id)}
            />}
            {data && <Button
              variant="ghost"
              onClick={() => setActivityOpen(true)}
              aria-label={`최근 활동 열기, UI 요청 ${experience.activity.length}개`}
              aria-haspopup="dialog"
            >
              <Bell className="size-3.5" aria-hidden="true" />
              활동
              {(experience.activity.length > 0 || data.recentJobCounts.active > 0) && <span className="rounded-full bg-cyan-950 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
                {experience.activity.length + data.recentJobCounts.active}
              </span>}
            </Button>}
            <Button onClick={() => void refresh(true)} disabled={refreshing}>
              <RefreshCw className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`} />
              {refreshing ? "상태 갱신 중" : "지금 갱신"}
            </Button>
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-600">{data
            ? `${data.availability.connected ? "Updated" : "Last good"} ${formatDate(data.generatedAt)}`
            : "운영 상태를 불러오는 중"}</div>
        </div>
      </div>

      {error && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-950/55 px-4 py-3 text-xs text-red-200" role="alert">
        <span className="min-w-0 flex-1">{error}</span>
        <Button variant="ghost" className="h-7 border border-red-900/50 text-[10px]" onClick={() => void refresh(true)} disabled={refreshing}>
          <RefreshCw className={`size-3 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
          다시 불러오기
        </Button>
      </div>}
      {loading && !data && <div className="grid min-h-[50vh] place-items-center">
        <div className="flex items-center gap-2 text-xs text-zinc-500"><RefreshCw className="size-4 motion-safe:animate-spin" />Dream과 Jobs 상태를 구성하는 중…</div>
      </div>}

      {data && <>
        <AvailabilityBanner data={data} />
        {data.availability.connected && !data.management.enabled && <div className="flex items-start gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-zinc-300" role="status">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-500" />
          <div>
            <div className="text-xs font-medium">직접 실행은 서버에서 비활성화되어 있습니다</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">상태 조회는 계속 사용할 수 있으며, 관리 작업은 서버 설정과 Control MCP 연결이 모두 정상일 때만 활성화됩니다.</p>
          </div>
        </div>}
        {actions.result && <ActionReceipt
          result={actions.result}
          record={currentActivityRecord}
          onSelectJob={selectJobAndReveal}
        />}
        <OperationsInbox
          items={inboxItems}
          onAction={(item) => void handleInboxAction(item)}
          onView={handleInboxView}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={BrainCircuit}
            label="Control MCP"
            value={data.availability.connected ? "Connected" : data.availability.configured ? "Degraded" : "Not configured"}
            detail={data.version ? `GBrain ${data.version}` : "운영 API 버전을 확인할 수 없습니다."}
            tone={data.availability.connected ? "good" : data.availability.configured ? "warning" : "neutral"}
          />
          <OverviewCard
            icon={DatabaseZap}
            label="Sources"
            value={enabledSources.length ? `${freshSources} / ${enabledSources.length} fresh` : "Sync disabled"}
            detail={data.sources.length ? `${formatNumber(data.sources.reduce((sum, source) => sum + source.pages, 0))} pages across visible sources` : "표시 가능한 source 상태가 없습니다."}
            tone={enabledSources.length && freshSources === enabledSources.length ? "good" : enabledSources.length ? "warning" : "neutral"}
          />
          <OverviewCard
            icon={Sparkles}
            label="Latest Dream"
            value={data.latestFullRun
              ? data.latestFullRun.reportStatus === "ok" ? "Healthy"
                : data.latestFullRun.reportStatus === "warn" ? "Needs review"
                  : data.latestFullRun.reportStatus === "fail" ? "Failed"
                    : data.latestFullRun.reportStatus === "running" ? "Running" : "Summary only"
              : "No run"}
            detail={data.latestFullRun ? `${formatDate(data.latestFullRun.finishedAt)} · ${formatDuration(data.latestFullRun.durationMs)}` : "전체 cycle 실행 기록이 없습니다."}
            tone={data.latestFullRun?.reportStatus === "ok" ? "good"
              : data.latestFullRun?.reportStatus === "warn" || data.latestFullRun?.reportStatus === "running" ? "warning"
                : data.latestFullRun?.reportStatus === "fail" ? "danger" : "neutral"}
          />
          <OverviewCard
            icon={Activity}
            label={`Recent ${data.recentJobCounts.sampleSize} Jobs`}
            value={unhealthyJobs ? `${unhealthyJobs} unhealthy` : data.recentJobCounts.sampleSize ? "No failures" : "No jobs"}
            detail={`${data.recentJobCounts.active} active · ${data.recentJobCounts.waiting + data.recentJobCounts.waitingChildren} waiting · ${data.recentJobCounts.completed} completed`}
            tone={unhealthyJobs ? "danger" : data.recentJobCounts.sampleSize ? "good" : "neutral"}
          />
        </div>

        {!!data.sources.length && <Panel className="p-4">
          <div className="mb-3 flex items-center gap-2"><Layers3 className="size-4 text-zinc-500" /><h2 className="text-xs font-semibold text-zinc-200">Sources & Embedding</h2></div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{data.sources.map((source) => <SourceCard
            key={source.id}
            source={source}
            jobs={data.jobs}
            managementEnabled={data.management.enabled}
            executing={actions.executing}
            onAction={openAction}
            onView={(source) => setSourceDetailId(source.id)}
          />)}</div>
        </Panel>}

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <RunPanel title="Latest full cycle" run={data.latestFullRun} />
          <RunPanel title="Latest targeted maintenance" run={data.latestTargetedRun} />
        </div>

        <ControlTrends
          generatedAt={data.generatedAt}
          sources={data.sources}
          jobs={data.jobs}
          points={experience.trendPoints}
        />

        <div ref={jobsPanelRef}>
          <Panel className="overflow-hidden">
          <header className="bg-zinc-900 px-4 py-3">
            <div className="flex items-center gap-2"><BarChart3 className="size-4 text-zinc-500" /><h2 className="text-sm font-semibold text-zinc-100">Background Jobs</h2></div>
            <p className="mt-1 text-[10px] text-zinc-500">최근 {data.recentJobCounts.sampleSize}개 작업의 구조화된 결과입니다. Job 완료와 Dream report 상태를 분리해 표시합니다.</p>
            <div className="mt-3"><JobDistribution counts={data.recentJobCounts} /></div>
          </header>
          <div className="px-4 pt-4">
            <ControlJobFilters
              value={jobFilters}
              jobs={data.jobs}
              sources={data.sources}
              onChange={setJobFilters}
              resultCount={filteredJobs.length}
            />
          </div>
          <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
            <JobList jobs={filteredJobs} selectedId={selectedJobId} onSelect={(job) => setSelectedJobId(job.id)} />
            <JobDetail
              job={selectedJob}
              jobs={data.jobs}
              managementEnabled={data.management.enabled}
              executing={actions.executing}
              onAction={openAction}
              onSelectJob={(job) => setSelectedJobId(job.id)}
            />
          </div>
          </Panel>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-3 text-[10px] text-zinc-700">
          <span className="flex items-center gap-1.5"><Clock3 className="size-3" />작업 중 5초, 그 외 15초마다 갱신 · 백그라운드 탭에서는 일시 정지</span>
          <span>Guarded Control Center · 고정 작업과 정규화된 결과만 브라우저에 전송합니다.</span>
        </footer>
      </>}
    </div>
    <ActivityDrawer
      open={activityOpen}
      receipts={experience.activity.map((record) => record.result)}
      jobs={data?.jobs ?? []}
      onClose={() => setActivityOpen(false)}
      onSelectJob={(jobId) => {
        setActivityOpen(false);
        selectJobAndReveal(jobId);
      }}
    />
    <SourceDetailDrawer
      source={sourceDetail}
      jobs={data?.jobs ?? []}
      trendPoints={sourceDetail
        ? experience.trendPoints
          .filter((point) => point.sourceId === sourceDetail.id)
          .map((point) => ({
            at: point.at,
            pages: point.pages,
            embeddingCoveragePct: point.embeddingCoveragePct,
          }))
        : []}
      managementEnabled={data?.management.enabled ?? false}
      executing={actions.executing}
      onClose={() => setSourceDetailId(null)}
      onAction={(action, source) => openAction({ action, source })}
    />
    {actionIntent && <ControlActionDialog
      intent={actionIntent}
      executing={actions.executing}
      error={actions.error}
      failure={actions.failure}
      preview={actionPreview}
      onClose={closeAction}
      onConfirm={executeAction}
      onRecovery={recoverAction}
    />}
  </section>;
}
