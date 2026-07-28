import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  LoaderCircle,
  PanelRightClose,
  ReceiptText,
  Workflow,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef } from "react";
import type { ControlActionName, ControlActionResult, ControlJob, ControlJobStatus } from "../../types";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";

export type ActivityStage = "received" | "waiting" | "running" | "finished" | "verification";

export interface ActivityDrawerProps {
  open: boolean;
  receipts: ControlActionResult[];
  jobs: ControlJob[];
  onClose: () => void;
  onSelectJob?: (jobId: number) => void;
}

interface ActivityEntry {
  id: string;
  stage: ActivityStage;
  title: string;
  description: string;
  occurredAt: string | null;
  jobId: number | null;
  jobStatus: ControlJobStatus | null;
  progress: number | null;
  progressLabel: string | null;
  replayed: boolean;
}

const ACTION_LABELS: Record<ControlActionName, string> = {
  "quick-dream": "Quick Dream",
  "source-sync": "Source 동기화",
  "embedding-refresh": "Embedding 갱신",
  "job-retry": "Job 재시도",
  "job-cancel": "Job 취소",
};

const STAGE_PRESENTATION: Record<ActivityStage, {
  label: string;
  icon: typeof CircleDot;
  iconClassName: string;
  dotClassName: string;
}> = {
  received: {
    label: "접수",
    icon: ReceiptText,
    iconClassName: "text-sky-300",
    dotClassName: "bg-sky-500",
  },
  waiting: {
    label: "대기",
    icon: Clock3,
    iconClassName: "text-amber-300",
    dotClassName: "bg-amber-500",
  },
  running: {
    label: "실행",
    icon: LoaderCircle,
    iconClassName: "text-cyan-300",
    dotClassName: "bg-cyan-500",
  },
  finished: {
    label: "완료",
    icon: CheckCircle2,
    iconClassName: "text-emerald-300",
    dotClassName: "bg-emerald-500",
  },
  verification: {
    label: "확인 필요",
    icon: AlertTriangle,
    iconClassName: "text-amber-200",
    dotClassName: "bg-amber-400",
  },
};

const WAITING_STATUSES = new Set<ControlJobStatus>(["waiting", "waiting-children", "paused", "delayed"]);
const FINISHED_STATUSES = new Set<ControlJobStatus>(["completed", "failed", "dead", "cancelled"]);

function stageForJob(status: ControlJobStatus): ActivityStage {
  if (status === "active") return "running";
  if (WAITING_STATUSES.has(status)) return "waiting";
  if (FINISHED_STATUSES.has(status)) return "finished";
  return "received";
}

function formatDate(value: string | null): string {
  if (!value) return "시간 기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 기록 없음";
  return date.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function eventTime(job: ControlJob): string | null {
  if (FINISHED_STATUSES.has(job.status)) return job.finishedAt ?? job.startedAt ?? job.createdAt;
  if (job.status === "active") return job.startedAt ?? job.createdAt;
  return job.createdAt;
}

function createReceiptEntry(result: ControlActionResult): ActivityEntry {
  const pending = result.outcome === "pending-verification";
  return {
    id: `receipt-${result.actionId}`,
    stage: pending ? "verification" : "received",
    title: `${ACTION_LABELS[result.action]} ${pending ? "접수 확인 필요" : "접수"}`,
    description: result.message,
    occurredAt: result.generatedAt,
    jobId: result.job?.id ?? null,
    jobStatus: result.job?.status ?? null,
    progress: null,
    progressLabel: null,
    replayed: result.replayed,
  };
}

function createJobEntry(job: ControlJob): ActivityEntry {
  const progress = job.progress?.percent ?? null;
  const progressLabel = job.progress?.message
    ?? (job.progress?.phase ? job.progress.phase.replaceAll("_", " ") : null);
  return {
    id: `job-${job.id}`,
    stage: stageForJob(job.status),
    title: job.label,
    description: job.sourceId ? `Source ${job.sourceId}` : "Brain-wide 작업",
    occurredAt: eventTime(job),
    jobId: job.id,
    jobStatus: job.status,
    progress,
    progressLabel,
    replayed: false,
  };
}

function stageCountLabel(entries: ActivityEntry[]): string {
  const counts = { received: 0, waiting: 0, running: 0, finished: 0, verification: 0 };
  for (const entry of entries) counts[entry.stage] += 1;
  const labels = [
    counts.verification ? `확인 필요 ${counts.verification}` : "",
    counts.running ? `실행 ${counts.running}` : "",
    counts.waiting ? `대기 ${counts.waiting}` : "",
    counts.received ? `접수 ${counts.received}` : "",
    counts.finished ? `완료 ${counts.finished}` : "",
  ].filter(Boolean);
  return labels.join(", ");
}

function ActivityCard({
  entry,
  onSelectJob,
}: {
  entry: ActivityEntry;
  onSelectJob?: (jobId: number) => void;
}) {
  const presentation = STAGE_PRESENTATION[entry.stage];
  const Icon = presentation.icon;
  const pendingVerification = entry.stage === "verification";

  return <li className="relative pl-8">
    <span className={`absolute left-[0.42rem] top-1.5 z-10 size-2.5 rounded-full ring-4 ring-zinc-950 ${presentation.dotClassName}`} aria-hidden="true" />
    <article className={`rounded-lg p-3 ${
      pendingVerification
        ? "bg-amber-950/40 ring-1 ring-inset ring-amber-700/40"
        : "bg-zinc-900/90"
    }`}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={`mt-0.5 size-3.5 shrink-0 ${presentation.iconClassName} ${
            entry.stage === "running" ? "motion-safe:animate-spin" : ""
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={`text-[9px] font-semibold uppercase tracking-[0.1em] ${presentation.iconClassName}`}>
              {presentation.label}
            </span>
            {entry.replayed && <span className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] text-zinc-400">동일 요청 재확인</span>}
            <time className="ml-auto shrink-0 text-[9px] text-zinc-600" dateTime={entry.occurredAt ?? undefined}>
              {formatDate(entry.occurredAt)}
            </time>
          </div>
          <h3 className="mt-1 text-xs font-medium leading-relaxed text-zinc-100">{entry.title}</h3>
          <p className={`mt-1 text-[10px] leading-relaxed ${pendingVerification ? "text-amber-100/75" : "text-zinc-500"}`}>
            {entry.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {entry.jobId !== null && <span className="font-mono text-[10px] text-zinc-500">Job #{entry.jobId}</span>}
            {entry.jobStatus && <StatusBadge status={entry.jobStatus} />}
          </div>
          {entry.progress !== null && <div className="mt-2">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
              role="progressbar"
              aria-label={`${entry.title} 진행률`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={entry.progress}
            >
              <div
                className="h-full rounded-full bg-cyan-500 transition-[width]"
                style={{ width: `${Math.max(0, Math.min(100, entry.progress))}%` }}
              />
            </div>
            <div className="mt-1 flex gap-2 text-[9px] text-zinc-500">
              {entry.progressLabel && <span className="min-w-0 flex-1 truncate">{entry.progressLabel}</span>}
              <span className="ml-auto shrink-0 font-mono text-cyan-300">{entry.progress.toFixed(0)}%</span>
            </div>
          </div>}
          {entry.jobId !== null && onSelectJob && <Button
            variant="ghost"
            className="mt-2 h-7 px-2 text-[10px]"
            onClick={() => onSelectJob(entry.jobId!)}
            aria-label={`Job #${entry.jobId} 상세 보기`}
          >
            Job 보기
            <ChevronRight className="size-3" aria-hidden="true" />
          </Button>}
        </div>
      </div>
    </article>
  </li>;
}

export function ActivityDrawer({
  open,
  receipts,
  jobs,
  onClose,
  onSelectJob,
}: ActivityDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  onCloseRef.current = onClose;

  const entries = useMemo(() => {
    return [
      ...receipts.map(createReceiptEntry),
      ...jobs.map(createJobEntry),
    ].sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [jobs, receipts]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const countSummary = entries.length ? stageCountLabel(entries) : "최근 활동 없음";

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="activity-drawer-backdrop"
    >
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="ml-auto flex h-full w-full max-w-md flex-col bg-zinc-950 shadow-[-24px_0_60px_rgba(0,0,0,0.45)] outline-none sm:border-l sm:border-zinc-800"
        data-testid="activity-drawer"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800 bg-zinc-900/80 px-4 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-cyan-300">
            <Workflow className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-zinc-100">최근 활동</h2>
            <p id={descriptionId} className="mt-1 text-[10px] leading-relaxed text-zinc-500">
              관리 요청과 background job의 접수, 대기, 실행, 완료 상태입니다.
            </p>
            <p className="mt-1 text-[10px] text-zinc-400" aria-live="polite">{countSummary}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="최근 활동 닫기"
            title="닫기"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
          {!entries.length ? <div className="grid min-h-64 place-items-center px-5 text-center" role="status">
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-full bg-zinc-900 text-zinc-500">
                <PanelRightClose className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-xs font-medium text-zinc-300">표시할 최근 활동이 없습니다</h3>
              <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-zinc-600">
                Control Center에서 관리 작업을 접수하거나 background job이 생성되면 여기에 진행 단계가 표시됩니다.
              </p>
            </div>
          </div> : <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[0.68rem] before:top-2 before:w-px before:bg-zinc-800" aria-label="최근 GBrain 활동 타임라인">
            {entries.map((entry) => <ActivityCard key={entry.id} entry={entry} onSelectJob={onSelectJob} />)}
          </ol>}
        </div>

        <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="flex items-center gap-2 text-[10px] leading-relaxed text-zinc-600">
            <CircleDot className="size-3 shrink-0" aria-hidden="true" />
            상태는 Control Center의 자동 갱신 주기에 맞춰 업데이트됩니다.
          </p>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
