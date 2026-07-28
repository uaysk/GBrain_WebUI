import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Clock3,
  DatabaseZap,
  Lightbulb,
  RefreshCw,
  TrendingUp,
  Workflow,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, type MouseEvent } from "react";
import type { ControlJob, ControlSourceStatus, ControlTone } from "../../types";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";

export type SourceDetailAction = "quick-dream" | "source-sync" | "embedding-refresh";

export interface SourceTrendPoint {
  at: string;
  pages: number;
  embeddingCoveragePct: number;
}

export interface SourceRecommendation {
  id: string;
  title: string;
  description: string;
  action?: SourceDetailAction;
  actionLabel?: string;
  tone?: ControlTone;
}

export interface SourceDetailDrawerProps {
  source: ControlSourceStatus | null;
  jobs: ControlJob[];
  trendPoints?: SourceTrendPoint[];
  recommendations?: SourceRecommendation[];
  managementEnabled: boolean;
  executing?: boolean;
  onClose: () => void;
  onAction?: (action: SourceDetailAction, source: ControlSourceStatus) => void;
}

const OPEN_STATUSES = new Set(["waiting", "waiting-children", "active", "delayed", "paused"]);
const FAILED_STATUSES = new Set(["failed", "dead"]);

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function timestamp(job: ControlJob): number {
  const value = job.finishedAt ?? job.startedAt ?? job.createdAt;
  return value ? new Date(value).getTime() : 0;
}

function defaultRecommendations(source: ControlSourceStatus, jobs: ControlJob[]): SourceRecommendation[] {
  const recommendations: SourceRecommendation[] = [];
  const failed = jobs.find((job) => FAILED_STATUSES.has(job.status));
  if (failed) {
    recommendations.push({
      id: `failed-${failed.id}`,
      title: `실패한 ${failed.label} 확인`,
      description: `Job #${failed.id}의 오류를 먼저 확인하면 같은 문제가 반복되는 것을 줄일 수 있습니다.`,
      tone: "danger",
    });
  }
  if (source.syncEnabled && (source.stalenessClass === "stale" || source.stalenessClass === "aging")) {
    recommendations.push({
      id: "source-sync",
      title: "Source 최신 상태 복원",
      description: `최근 동기화 이후 ${source.stalenessHours.toFixed(1)}시간이 지나 원본 변경 사항을 확인하는 것이 좋습니다.`,
      action: "source-sync",
      actionLabel: "동기화",
      tone: source.stalenessClass === "stale" ? "danger" : "warning",
    });
  }
  if (source.chunksUnembedded > 0) {
    recommendations.push({
      id: "embedding-refresh",
      title: "누락 Embedding 갱신",
      description: `${formatNumber(source.chunksUnembedded)}개 chunk가 의미 검색에 아직 반영되지 않았습니다.`,
      action: "embedding-refresh",
      actionLabel: "Embedding 갱신",
      tone: source.embeddingCoveragePct < 90 ? "danger" : "warning",
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      id: "healthy",
      title: "현재 상태가 안정적입니다",
      description: "Source freshness와 Embedding 적용률에 즉시 조치가 필요한 항목이 없습니다.",
      action: source.syncEnabled ? "quick-dream" : undefined,
      actionLabel: "Quick Dream 검토",
      tone: "good",
    });
  }
  return recommendations.slice(0, 3);
}

function recommendationClass(tone: ControlTone = "neutral"): string {
  if (tone === "danger") return "bg-red-950/30 text-red-200";
  if (tone === "warning") return "bg-amber-950/30 text-amber-200";
  if (tone === "good") return "bg-emerald-950/25 text-emerald-200";
  return "bg-zinc-900 text-zinc-300";
}

function actionUnavailableReason(
  action: SourceDetailAction,
  source: ControlSourceStatus,
  jobs: ControlJob[],
  managementEnabled: boolean,
  executing: boolean,
): string | null {
  if (!managementEnabled) return "직접 실행이 비활성화되어 있습니다.";
  if (executing) return "다른 관리 요청을 처리하고 있습니다.";
  const openNames = new Set(
    jobs
      .filter((job) => OPEN_STATUSES.has(job.status))
      .map((job) => job.name),
  );
  if (action === "quick-dream" && openNames.has("autopilot-cycle")) return "Quick Dream이 이미 진행 중입니다.";
  if (action === "source-sync") {
    if (!source.syncEnabled) return "이 Source는 동기화가 비활성화되어 있습니다.";
    if (openNames.has("sync") || openNames.has("autopilot-cycle")) return "동기화 또는 Dream 작업이 이미 진행 중입니다.";
  }
  if (action === "embedding-refresh") {
    if (source.chunksUnembedded <= 0) return "갱신할 누락 Embedding이 없습니다.";
    if (
      source.backfillActive > 0
      || source.backfillQueued > 0
      || openNames.has("embed")
      || openNames.has("embed-backfill")
      || openNames.has("autopilot-cycle")
    ) return "Embedding 작업이 이미 진행 중입니다.";
  }
  return null;
}

function SourceTrend({ source, points }: { source: ControlSourceStatus; points: SourceTrendPoint[] }) {
  const normalized = points.length
    ? points
    : [{ at: source.lastSyncAt ?? new Date().toISOString(), pages: source.pages, embeddingCoveragePct: source.embeddingCoveragePct }];
  const width = 320;
  const height = 88;
  const inset = 8;
  const values = normalized.map((point) => Math.max(0, Math.min(100, point.embeddingCoveragePct)));
  const x = (index: number) => normalized.length === 1
    ? width / 2
    : inset + (index / (normalized.length - 1)) * (width - inset * 2);
  const y = (value: number) => inset + ((100 - value) / 100) * (height - inset * 2);
  const path = normalized.map((point, index) =>
    `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(point.embeddingCoveragePct).toFixed(1)}`).join(" ");
  const pageDelta = normalized.length > 1 ? normalized.at(-1)!.pages - normalized[0].pages : 0;

  return <section aria-labelledby="source-trend-title">
    <div className="flex items-center gap-2">
      <TrendingUp className="size-3.5 text-zinc-500" aria-hidden="true" />
      <h3 id="source-trend-title" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        Embedding 추세
      </h3>
      <span className="ml-auto text-[10px] text-zinc-600">
        {normalized.length > 1 ? `${normalized.length}개 관측점 · pages ${pageDelta >= 0 ? "+" : ""}${formatNumber(pageDelta)}` : "현재 스냅샷"}
      </span>
    </div>
    <div className="mt-2 rounded-lg bg-black/20 px-3 py-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Embedding 적용률 ${values[0].toFixed(1)}%에서 ${values.at(-1)!.toFixed(1)}%까지의 추세`}
        className="h-24 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {[25, 50, 75, 100].map((tick) => <line
          key={tick}
          x1={inset}
          x2={width - inset}
          y1={y(tick)}
          y2={y(tick)}
          className="stroke-zinc-800"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />)}
        <path
          d={path}
          fill="none"
          className="stroke-emerald-500"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {normalized.map((point, index) => <circle
          key={`${point.at}-${index}`}
          cx={x(index)}
          cy={y(point.embeddingCoveragePct)}
          r="2.8"
          className="fill-emerald-300 stroke-emerald-950"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />)}
      </svg>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{formatDate(normalized[0].at)}</span>
        <strong className="font-mono font-medium text-emerald-300">{values.at(-1)!.toFixed(1)}%</strong>
        <span>{formatDate(normalized.at(-1)!.at)}</span>
      </div>
      <ol className="sr-only">
        {normalized.map((point) => <li key={point.at}>
          {formatDate(point.at)}: {formatNumber(point.pages)} pages, Embedding {point.embeddingCoveragePct.toFixed(1)}%
        </li>)}
      </ol>
    </div>
  </section>;
}

export function SourceDetailDrawer({
  source,
  jobs,
  trendPoints = [],
  recommendations,
  managementEnabled,
  executing = false,
  onClose,
  onAction,
}: SourceDetailDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const sourceJobs = useMemo(() => {
    if (!source) return [];
    return jobs
      .filter((job) => job.sourceId === source.id)
      .sort((left, right) => timestamp(right) - timestamp(left));
  }, [jobs, source]);
  const activeJobs = sourceJobs.filter((job) => OPEN_STATUSES.has(job.status));
  const failedJobs = sourceJobs.filter((job) => FAILED_STATUSES.has(job.status));
  const visibleRecommendations = useMemo(
    () => source ? recommendations ?? defaultRecommendations(source, sourceJobs) : [],
    [recommendations, source, sourceJobs],
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!source) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const elements = [...drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [source]);

  if (!source || typeof document === "undefined") return null;

  const coverageTone = source.embeddingCoveragePct >= 98 ? "text-emerald-300"
    : source.embeddingCoveragePct >= 90 ? "text-amber-300" : "text-red-300";
  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const invoke = (action: SourceDetailAction) => {
    if (actionUnavailableReason(action, source, sourceJobs, managementEnabled, executing)) return;
    onAction?.(action, source);
  };

  return createPortal(<div
    className="fixed inset-0 z-[105] flex items-end justify-end bg-black/70 backdrop-blur-sm sm:items-stretch"
    onMouseDown={closeFromBackdrop}
    data-testid="source-detail-backdrop"
  >
    <article
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-zinc-950 text-zinc-200 shadow-2xl sm:max-h-none sm:w-[min(520px,92vw)] sm:rounded-none sm:border-l sm:border-zinc-800"
      data-testid="source-detail-drawer"
    >
      <header className="flex shrink-0 items-start gap-3 bg-zinc-900 px-4 py-4 sm:px-5">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-950 text-cyan-300">
          <DatabaseZap className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Source 상세</div>
          <h2 id={titleId} className="mt-1 truncate text-sm font-semibold text-zinc-100" title={source.name}>{source.name}</h2>
          <div className="mt-1 break-all font-mono text-[10px] text-zinc-600">{source.id}</div>
        </div>
        <button
          type="button"
          aria-label={`${source.name} 상세 닫기`}
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-white focus-visible:bg-zinc-700 focus-visible:text-white focus-visible:outline-none"
        ><X className="size-4" aria-hidden="true" /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
        <section aria-label="Source 현재 상태" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-black/20 px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-wide text-zinc-600">Pages</div>
            <div className="mt-1 font-mono text-base font-semibold text-zinc-200">{formatNumber(source.pages)}</div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-wide text-zinc-600">Chunks</div>
            <div className="mt-1 font-mono text-base font-semibold text-zinc-200">{formatNumber(source.chunksTotal)}</div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-wide text-zinc-600">Embedded</div>
            <div className={`mt-1 font-mono text-base font-semibold ${coverageTone}`}>{source.embeddingCoveragePct.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-wide text-zinc-600">Freshness</div>
            <div className="mt-1 truncate text-xs font-semibold text-zinc-200">{source.syncEnabled ? source.stalenessClass : "sync off"}</div>
          </div>
        </section>

        <div className="rounded-lg bg-black/20 px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1.5"><Clock3 className="size-3" aria-hidden="true" />최근 sync {formatDate(source.lastSyncAt)}</span>
            <span>{formatNumber(source.chunksUnembedded)} unembedded</span>
            <span>{source.backfillActive} active · {source.backfillQueued} queued</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-label={`${source.name} Embedding 적용률`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={source.embeddingCoveragePct}
          >
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, source.embeddingCoveragePct))}%` }} />
          </div>
        </div>

        <SourceTrend source={source} points={trendPoints} />

        {(activeJobs.length > 0 || failedJobs.length > 0) && <section aria-labelledby={`${titleId}-attention`}>
          <div className="flex items-center gap-2">
            <Activity className="size-3.5 text-zinc-500" aria-hidden="true" />
            <h3 id={`${titleId}-attention`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">주의 및 진행 상태</h3>
          </div>
          <div className="mt-2 space-y-2">
            {activeJobs.slice(0, 3).map((job) => <div key={job.id} className="rounded-lg bg-cyan-950/25 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Workflow className="size-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
                <strong className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{job.label}</strong>
                <StatusBadge status={job.status} />
              </div>
              <div className="mt-1.5 pl-5 text-[10px] text-zinc-500">Job #{job.id}{job.progress?.message ? ` · ${job.progress.message}` : ""}</div>
            </div>)}
            {failedJobs.slice(0, 2).map((job) => <div key={job.id} className="rounded-lg bg-red-950/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-3.5 shrink-0 text-red-400" aria-hidden="true" />
                <strong className="min-w-0 flex-1 truncate text-[11px] font-medium text-red-200">{job.label} · #{job.id}</strong>
                <StatusBadge status={job.status} />
              </div>
              <p className="mt-1.5 line-clamp-3 pl-5 text-[10px] leading-relaxed text-red-200/65">{job.error ?? "구조화된 오류 메시지가 없습니다."}</p>
            </div>)}
          </div>
        </section>}

        <section aria-labelledby={`${titleId}-recommendations`}>
          <div className="flex items-center gap-2">
            <Lightbulb className="size-3.5 text-zinc-500" aria-hidden="true" />
            <h3 id={`${titleId}-recommendations`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">추천 작업</h3>
          </div>
          <div className="mt-2 space-y-2">
            {visibleRecommendations.map((recommendation) => {
              const reason = recommendation.action
                ? actionUnavailableReason(recommendation.action, source, sourceJobs, managementEnabled, executing)
                : null;
              return <div key={recommendation.id} className={`rounded-lg px-3 py-3 ${recommendationClass(recommendation.tone)}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="text-[11px] font-medium">{recommendation.title}</strong>
                    <p className="mt-1 text-[10px] leading-relaxed opacity-65">{recommendation.description}</p>
                  </div>
                  {recommendation.action && <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-2 text-[10px]"
                    disabled={Boolean(reason) || !onAction}
                    title={reason ?? recommendation.actionLabel}
                    onClick={() => invoke(recommendation.action!)}
                  >
                    {recommendation.action === "quick-dream"
                      ? <BrainCircuit className="size-3" aria-hidden="true" />
                      : recommendation.action === "source-sync"
                        ? <RefreshCw className="size-3" aria-hidden="true" />
                        : <DatabaseZap className="size-3" aria-hidden="true" />}
                    {recommendation.actionLabel ?? "실행"}
                  </Button>}
                </div>
                {reason && recommendation.action && <div className="mt-2 text-[9px] opacity-55">{reason}</div>}
              </div>;
            })}
          </div>
        </section>

        <section aria-labelledby={`${titleId}-recent`}>
          <div className="flex items-center gap-2">
            <Workflow className="size-3.5 text-zinc-500" aria-hidden="true" />
            <h3 id={`${titleId}-recent`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">최근 관련 Job</h3>
          </div>
          {sourceJobs.length ? <ol className="mt-2 space-y-1.5">
            {sourceJobs.slice(0, 6).map((job) => <li key={job.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2">
              <span className="font-mono text-[10px] text-zinc-600">#{job.id}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{job.label}</span>
              <span className="hidden text-[9px] text-zinc-600 sm:inline">{formatDate(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
              <StatusBadge status={job.status} />
            </li>)}
          </ol> : <div className="mt-2 rounded-lg bg-black/15 px-3 py-5 text-center text-[11px] text-zinc-600">이 Source와 연결된 최근 Job이 없습니다.</div>}
        </section>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-zinc-900 px-4 py-3 sm:px-5">
        <span className="text-[9px] text-zinc-600">Esc로 닫기 · 실행 전 별도 확인이 필요합니다.</span>
        <Button type="button" variant="ghost" onClick={onClose}>닫기</Button>
      </footer>
    </article>
  </div>, document.body);
}
