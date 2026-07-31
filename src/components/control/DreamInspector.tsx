import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Info,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  ControlAffectedPages,
  ControlCenterResponse,
  ControlDreamFinding,
  ControlMetric,
  ControlPhase,
  ControlRun,
  ControlSectionFreshness,
} from "../../types";
import { useDreamRunDetail } from "../../hooks/useDreamRunDetail";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";
import {
  DREAM_INSPECTOR_TABS,
  dreamRunMapHref,
  parseDreamInspectorUrlState,
  serializeDreamInspectorUrlState,
  type DreamInspectorTab,
  type DreamInspectorUrlState,
} from "./dream-inspector-state";

const TAB_COPY: Record<DreamInspectorTab, string> = {
  overview: "요약",
  phases: "단계",
  comparison: "이전 실행 비교",
  affected: "영향 메모리",
};

const PHASE_CODE_COPY: Record<string, string> = {
  migration_required: "마이그레이션이 필요합니다.",
  feature_disabled: "관련 기능이 비활성화되어 있습니다.",
  pack_gated: "현재 활성 pack 범위 밖입니다.",
  insufficient_evidence: "판단 근거가 충분하지 않습니다.",
  budget_exhausted: "이번 실행의 처리 예산에 도달했습니다.",
};

function firstRunId(data: ControlCenterResponse): number | null {
  return data.dreamRuns?.find((run) => run.id !== null)?.id ?? null;
}

function initialUrlState(data: ControlCenterResponse): DreamInspectorUrlState {
  if (typeof window === "undefined") return { runId: firstRunId(data), tab: "overview", phase: null };
  const parsed = parseDreamInspectorUrlState(window.location.search);
  return { ...parsed, runId: parsed.runId ?? firstRunId(data) };
}

function formatDate(value: string | null): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return date.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}초`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}분 ${seconds}초`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function metricColor(metric: ControlMetric): string {
  if (metric.tone === "danger") return "text-red-300";
  if (metric.tone === "warning") return "text-amber-300";
  if (metric.tone === "good") return "text-emerald-300";
  return "text-zinc-200";
}

function countOnlyPhase(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().replaceAll("_", "-");
  return normalized.includes("propose") || normalized.includes("schema") || normalized.includes("orphan");
}

function qualityForRun(data: ControlCenterResponse, run: ControlRun): ControlSectionFreshness | null {
  if (!data.quality) return null;
  return run.sourceId === null ? data.quality.globalDreamRuns : data.quality.sourceDreamRuns;
}

function writeDreamUrl(state: DreamInspectorUrlState, mode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const params = serializeDreamInspectorUrlState(state, url.searchParams);
  const encoded = params.toString();
  const target = `/control${encoded ? `?${encoded}` : ""}${url.hash}`;
  if (mode === "push") window.history.pushState(window.history.state, "", target);
  else window.history.replaceState(window.history.state, "", target);
}

function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg bg-black/20 ${className}`}>{children}</section>;
}

function MetricGrid({ metrics }: { metrics: ControlMetric[] }) {
  if (!metrics.length) return <p className="rounded-lg bg-black/15 px-3 py-5 text-center text-[11px] text-zinc-600">집계된 metric이 없습니다.</p>;
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {metrics.map((metric) => <div key={metric.key} className="rounded-lg bg-zinc-950/55 px-3 py-2.5">
      <dd className={`font-mono text-base font-semibold ${metricColor(metric)}`}>{formatNumber(metric.value)}</dd>
      <dt className="mt-0.5 text-[10px] text-zinc-500">{metric.label}</dt>
    </div>)}
  </dl>;
}

function freshnessBadge(freshness: ControlSectionFreshness | null) {
  if (freshness === "stale") return <span className="rounded-full bg-amber-950/70 px-2 py-1 text-[9px] font-medium text-amber-300">stale</span>;
  if (freshness === "unavailable") return <span className="rounded-full bg-red-950/70 px-2 py-1 text-[9px] font-medium text-red-300">unavailable</span>;
  return null;
}

function HistoryList({
  data,
  selectedRunId,
  onSelect,
}: {
  data: ControlCenterResponse;
  selectedRunId: number | null;
  onSelect: (run: ControlRun) => void;
}) {
  const runs = data.dreamRuns ?? [];
  if (!runs.length) return <div className="px-4 py-10 text-center text-xs text-zinc-600">보존된 Dream 실행 이력이 없습니다.</div>;
  const selectOffset = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = runs.map((run, runIndex) => ({ run, runIndex })).filter(({ run }) => run.id !== null);
    const current = enabled.findIndex(({ runIndex }) => runIndex === index);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? enabled.length - 1
        : event.key === "ArrowDown" ? Math.min(enabled.length - 1, current + 1)
          : Math.max(0, current - 1);
    const target = enabled[next]?.run;
    if (!target) return;
    onSelect(target);
    requestAnimationFrame(() => document.getElementById(`dream-history-${target.id}`)?.focus());
  };
  return <ol className="max-h-[460px] space-y-1 overflow-y-auto p-2" aria-label="Dream 실행 이력">
    {runs.map((run, index) => {
      const selected = run.id !== null && selectedRunId === run.id;
      return <li key={`${run.id ?? "summary"}-${run.name}-${run.finishedAt ?? index}`}>
        <button
          id={run.id === null ? undefined : `dream-history-${run.id}`}
          type="button"
          disabled={run.id === null}
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelect(run)}
          onKeyDown={(event) => selectOffset(event, index)}
          className={`w-full rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-cyan-500 disabled:opacity-50 ${selected ? "bg-cyan-950/55" : "hover:bg-zinc-800/70"}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <StatusBadge status={run.reportStatus} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{run.label}</span>
            {freshnessBadge(qualityForRun(data, run))}
          </span>
          <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
            <span className="truncate">{run.sourceId ?? "global"} · #{run.id ?? "—"}</span>
            <time dateTime={run.finishedAt ?? undefined}>{formatDate(run.finishedAt)}</time>
          </span>
        </button>
      </li>;
    })}
  </ol>;
}

function RunOverview({ run, findings, onFinding }: {
  run: ControlRun;
  findings: ControlDreamFinding[];
  onFinding: (finding: ControlDreamFinding) => void;
}) {
  return <div className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-3">
      <Section className="p-3"><div className="text-[9px] uppercase tracking-wider text-zinc-600">단계</div><div className="mt-1 font-mono text-lg text-zinc-200">{run.phases.length}</div></Section>
      <Section className="p-3"><div className="text-[9px] uppercase tracking-wider text-zinc-600">소요 시간</div><div className="mt-1 font-mono text-lg text-zinc-200">{formatDuration(run.durationMs)}</div></Section>
      <Section className="p-3"><div className="text-[9px] uppercase tracking-wider text-zinc-600">보고서</div><div className="mt-2"><StatusBadge status={run.reportStatus} /></div></Section>
    </div>
    <Section className="p-4">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-200"><BarChart3 className="size-3.5 text-zinc-500" />변화 집계</h4>
      <MetricGrid metrics={run.impacts} />
    </Section>
    <Section className="p-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold text-zinc-200"><Sparkles className="size-3.5 text-violet-400" />주요 Findings <span className="text-[10px] font-normal text-zinc-600">최대 5개</span></h4>
      {!findings.length ? <p className="mt-3 rounded-lg bg-zinc-950/40 px-3 py-5 text-center text-[11px] text-zinc-600">검토가 필요한 finding이 없습니다.</p> : <ol className="mt-3 space-y-2">
        {findings.slice(0, 5).map((finding) => {
          const Icon = finding.kind === "failure" ? XCircle
            : finding.kind === "warning" ? AlertTriangle
              : finding.kind === "remediation" ? Info
                : finding.kind === "duration" ? Clock3 : BarChart3;
          const color = finding.kind === "failure" ? "text-red-300"
            : finding.kind === "warning" ? "text-amber-300"
              : finding.kind === "remediation" ? "text-cyan-300" : "text-zinc-400";
          const protectedDetail = countOnlyPhase(finding.phase)
            ? "세부 항목은 표시하지 않고 집계 건수만 제공합니다."
            : finding.detail;
          return <li key={finding.id}>
            <button type="button" disabled={!finding.phase} onClick={() => onFinding(finding)} className="flex w-full items-start gap-3 rounded-lg bg-zinc-950/45 px-3 py-3 text-left outline-none hover:bg-zinc-950/80 focus-visible:ring-1 focus-visible:ring-cyan-500 disabled:pointer-events-none">
              <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-zinc-200">{finding.label}</span><span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{protectedDetail}</span></span>
              {finding.phase && <ArrowRight className="mt-1 size-3 shrink-0 text-zinc-700" aria-hidden="true" />}
            </button>
          </li>;
        })}
      </ol>}
    </Section>
  </div>;
}

function PhaseDetail({ phase }: { phase: ControlPhase }) {
  const countOnly = countOnlyPhase(phase.name);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-start gap-2">
      <div className="mr-auto"><h4 className="text-sm font-semibold text-zinc-100">{phase.label}</h4><div className="mt-1 font-mono text-[10px] text-zinc-600">{phase.name}</div></div>
      <StatusBadge status={phase.status} />
      <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">{formatDuration(phase.durationMs)}</span>
    </div>
    <p className="rounded-lg bg-zinc-950/45 px-3 py-3 text-[11px] leading-relaxed text-zinc-400">
      {countOnly ? "제안·schema·orphan 단계는 세부 문장이나 행을 표시하지 않고 집계 건수만 제공합니다." : phase.summary}
    </p>
    <MetricGrid metrics={phase.metrics} />
    {!countOnly && !!phase.warnings.length && <ul className="space-y-1 rounded-lg bg-amber-950/25 px-3 py-2.5 text-[10px] text-amber-200">
      {phase.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{warning}</li>)}
    </ul>}
    {!!phase.codes?.length && <ul className="space-y-1 rounded-lg bg-cyan-950/20 px-3 py-2.5 text-[10px] text-cyan-200">
      {phase.codes.map((code) => <li key={code}>{PHASE_CODE_COPY[code] ?? code}</li>)}
    </ul>}
  </div>;
}

function PhasesTab({ run, selectedPhase, onSelect }: { run: ControlRun; selectedPhase: string | null; onSelect: (phase: string) => void }) {
  const active = run.phases.find((phase) => phase.name === selectedPhase) ?? run.phases[0] ?? null;
  if (!active) return <div className="rounded-lg bg-black/20 px-4 py-10 text-center text-xs text-zinc-600">이 실행에는 단계별 보고서가 없습니다.</div>;
  return <div className="grid gap-3 lg:grid-cols-[minmax(190px,0.34fr)_minmax(0,1fr)]">
    <ol className="max-h-[430px] space-y-1 overflow-y-auto rounded-lg bg-black/20 p-2" aria-label="Dream 단계">
      {run.phases.map((phase, index) => <li key={`${phase.name}-${index}`}>
        <button type="button" onClick={() => onSelect(phase.name)} aria-current={phase.name === active.name ? "step" : undefined} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 ${phase.name === active.name ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800"}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${phase.status === "fail" ? "bg-red-400" : phase.status === "warn" ? "bg-amber-400" : phase.status === "ok" ? "bg-emerald-400" : "bg-zinc-500"}`} />
          <span className="min-w-0 flex-1 truncate">{phase.label}</span>
          <span className="font-mono text-[9px] text-zinc-600">{formatDuration(phase.durationMs)}</span>
        </button>
      </li>)}
    </ol>
    <Section className="min-w-0 p-4"><PhaseDetail phase={active} /></Section>
  </div>;
}

function ComparisonTab({ run, previousRun, metrics }: {
  run: ControlRun;
  previousRun: ControlRun | null;
  metrics: Array<{ key: string; label: string; current: number; previous: number; delta: number }>;
}) {
  if (!previousRun) return <div className="rounded-lg bg-black/20 px-4 py-10 text-center text-xs text-zinc-600">같은 실행 이름과 source의 직전 실행이 없습니다.</div>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-3 py-3 text-[10px] text-zinc-500">
      <span className="text-zinc-300">#{previousRun.id ?? "—"} · {formatDate(previousRun.finishedAt)}</span>
      <ArrowRight className="size-3" />
      <span className="text-zinc-300">#{run.id ?? "—"} · {formatDate(run.finishedAt)}</span>
      <span className="ml-auto">공통 metric만 비교</span>
    </div>
    {!metrics.length ? <div className="rounded-lg bg-black/20 px-4 py-10 text-center text-xs text-zinc-600">두 실행에 공통으로 존재하는 metric이 없습니다.</div> : <div className="overflow-x-auto rounded-lg bg-black/20">
      <table className="w-full min-w-[520px] text-left text-[11px]">
        <thead className="text-[9px] uppercase tracking-wider text-zinc-600"><tr><th className="px-4 py-3 font-medium">Metric</th><th className="px-3 py-3 text-right font-medium">이전</th><th className="px-3 py-3 text-right font-medium">현재</th><th className="px-4 py-3 text-right font-medium">변화</th></tr></thead>
        <tbody>{metrics.map((metric) => <tr key={metric.key} className="border-t border-zinc-800/60"><th className="px-4 py-3 font-medium text-zinc-300">{metric.label}</th><td className="px-3 py-3 text-right font-mono text-zinc-500">{formatNumber(metric.previous)}</td><td className="px-3 py-3 text-right font-mono text-zinc-200">{formatNumber(metric.current)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${metric.delta > 0 ? "text-cyan-300" : metric.delta < 0 ? "text-amber-300" : "text-zinc-500"}`}>{metric.delta > 0 ? "+" : ""}{formatNumber(metric.delta)}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

function AffectedTab({ jobId, baseSearch, affected }: {
  jobId: number;
  baseSearch: string;
  affected: ControlAffectedPages;
}) {
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-3 py-3">
      <div className="mr-auto text-xs text-zinc-300"><strong className="font-mono text-cyan-300">{formatNumber(affected.total)}</strong>개 메모리 영향</div>
      {affected.truncated && <span className="rounded-full bg-amber-950 px-2 py-1 text-[9px] text-amber-300">일부만 표시</span>}
      <a href={dreamRunMapHref(jobId, baseSearch)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white hover:bg-cyan-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300">Map에서 보기<ExternalLink className="size-3" /></a>
    </div>
    {affected.coverage !== "complete" && <div className="rounded-lg bg-amber-950/25 px-3 py-2 text-[10px] leading-relaxed text-amber-200/80" role="status">{affected.coverage === "partial" ? "GBrain report의 명시적인 sync·synthesize page ref만 표시합니다. 다른 단계의 영향은 포함되지 않을 수 있습니다." : "이 실행 report에는 안전하게 식별할 수 있는 page ref가 없습니다. 원문 문장이나 로그에서 대상을 추측하지 않습니다."}</div>}
    {!affected.items.length ? <div className="rounded-lg bg-black/20 px-4 py-10 text-center text-xs text-zinc-600">표시할 수 있는 영향 페이지가 없습니다.</div> : <ol className="space-y-2">
      {affected.items.map((item) => <li key={`${item.sourceId}:${item.slug}`} className="rounded-lg bg-black/20 px-3 py-3">
        <div className="flex min-w-0 items-start gap-2"><FileText className="mt-0.5 size-3.5 shrink-0 text-cyan-500" /><div className="min-w-0"><div className="break-words font-mono text-[11px] text-zinc-200">{item.slug}</div><div className="mt-1 text-[9px] text-zinc-600">source · {item.sourceId}</div></div></div>
        {!!item.phases.length && <div className="mt-2 flex flex-wrap gap-1">{item.phases.map((phase) => <span key={phase} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">{phase}</span>)}</div>}
      </li>)}
    </ol>}
  </div>;
}

export interface DreamInspectorProps {
  data: ControlCenterResponse;
}

/** Read-only Dream history and allowlisted run-detail inspector. */
export function DreamInspector({ data }: DreamInspectorProps) {
  const initial = useMemo(() => initialUrlState(data), []);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(initial.runId);
  const [tab, setTab] = useState<DreamInspectorTab>(initial.tab);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(initial.phase);
  const { detail, loading, error, reload } = useDreamRunDetail(selectedRunId, data.generatedAt);
  const historyRun = data.dreamRuns?.find((run) => run.id === selectedRunId) ?? null;
  const run = detail?.run ?? historyRun;
  const phases = run?.phases ?? [];

  const commitUrl = useCallback((next: DreamInspectorUrlState, mode: "push" | "replace") => {
    writeDreamUrl(next, mode);
  }, []);

  useEffect(() => {
    if (selectedRunId !== null || firstRunId(data) === null) return;
    const runId = firstRunId(data);
    setSelectedRunId(runId);
    commitUrl({ runId, tab, phase: selectedPhase }, "replace");
  }, [commitUrl, data, selectedPhase, selectedRunId, tab]);

  useEffect(() => {
    const onPopState = () => {
      const restored = parseDreamInspectorUrlState(window.location.search);
      setSelectedRunId(restored.runId ?? firstRunId(data));
      setTab(restored.tab);
      setSelectedPhase(restored.phase);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [data]);

  useEffect(() => {
    if (!run) return;
    const nextPhase = phases.some((phase) => phase.name === selectedPhase) ? selectedPhase : phases[0]?.name ?? null;
    if (nextPhase === selectedPhase) return;
    setSelectedPhase(nextPhase);
    commitUrl({ runId: selectedRunId, tab, phase: nextPhase }, "replace");
  }, [commitUrl, phases, run, selectedPhase, selectedRunId, tab]);

  const selectRun = (nextRun: ControlRun) => {
    if (nextRun.id === null) return;
    const phase = nextRun.phases[0]?.name ?? null;
    setSelectedRunId(nextRun.id);
    setTab("overview");
    setSelectedPhase(phase);
    commitUrl({ runId: nextRun.id, tab: "overview", phase }, "push");
  };
  const selectTab = (nextTab: DreamInspectorTab) => {
    setTab(nextTab);
    commitUrl({ runId: selectedRunId, tab: nextTab, phase: selectedPhase }, "push");
  };
  const selectPhase = (phase: string) => {
    setSelectedPhase(phase);
    commitUrl({ runId: selectedRunId, tab: "phases", phase }, "push");
  };
  const selectFinding = (finding: ControlDreamFinding) => {
    if (!finding.phase) return;
    setTab("phases");
    setSelectedPhase(finding.phase);
    commitUrl({ runId: selectedRunId, tab: "phases", phase: finding.phase }, "push");
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = DREAM_INSPECTOR_TABS.indexOf(tab);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? DREAM_INSPECTOR_TABS.length - 1
        : event.key === "ArrowRight" ? (current + 1) % DREAM_INSPECTOR_TABS.length
          : (current - 1 + DREAM_INSPECTOR_TABS.length) % DREAM_INSPECTOR_TABS.length;
    const next = DREAM_INSPECTOR_TABS[nextIndex]!;
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`dream-tab-${next}`)?.focus());
  };

  const historyQuality = data.quality && [data.quality.sourceDreamRuns, data.quality.globalDreamRuns].some((value) => value !== "fresh");
  const mapHref = selectedRunId === null ? "/" : dreamRunMapHref(selectedRunId, typeof window === "undefined" ? "" : window.location.search);
  return <section className="overflow-hidden rounded-xl bg-zinc-900/70" data-testid="dream-inspector" aria-labelledby="dream-inspector-title">
    <header className="flex flex-wrap items-start gap-3 bg-zinc-900 px-4 py-3">
      <div className="mr-auto">
        <div className="flex items-center gap-2"><BrainCircuit className="size-4 text-violet-400" /><h2 id="dream-inspector-title" className="text-sm font-semibold text-zinc-100">Dream Inspector</h2></div>
        <p className="mt-1 text-[10px] text-zinc-500">실행 이력, 단계, 이전 실행과의 변화, 영향받은 메모리를 안전한 구조화 결과로 탐색합니다.</p>
      </div>
      {historyQuality && <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/70 px-2.5 py-1 text-[10px] text-amber-300"><AlertTriangle className="size-3" />일부 이력 stale/unavailable</span>}
    </header>
    <div className="grid min-w-0 lg:grid-cols-[minmax(250px,0.34fr)_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-zinc-800/70 lg:border-b-0 lg:border-r" data-testid="dream-history">
        <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600"><History className="size-3" />최근 실행</div>
        <HistoryList data={data} selectedRunId={selectedRunId} onSelect={selectRun} />
      </aside>
      <div className="min-w-0 p-3 sm:p-4" data-testid="dream-detail">
        {run && <div className="mb-3 flex flex-wrap items-start gap-2">
          <div className="mr-auto min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-zinc-100">{run.label}</h3><StatusBadge status={run.reportStatus} />{detail?.stale && <span data-testid="dream-detail-stale" className="rounded-full bg-amber-950/70 px-2 py-1 text-[9px] text-amber-300">보존된 상세</span>}</div><p className="mt-1 text-[10px] text-zinc-600">{run.sourceId ?? "global"} · #{run.id ?? selectedRunId ?? "—"} · {formatDate(run.finishedAt)}</p></div>
          {selectedRunId !== null && <a href={mapHref} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-800 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500">Map 연결<ExternalLink className="size-3" /></a>}
        </div>}
        {detail?.stale && <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-950/30 px-3 py-2.5 text-[10px] leading-relaxed text-amber-200" role="status"><AlertTriangle className="mt-0.5 size-3 shrink-0" />이번 polling에서 상세 section을 갱신하지 못해 마지막으로 검증된 결과를 표시합니다.</div>}
        {error && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-950/40 px-3 py-2.5 text-[11px] text-red-200" role="alert" data-testid="dream-detail-error"><span className="min-w-0 flex-1">{error}</span><Button variant="ghost" className="h-7 text-[10px] text-red-100" onClick={() => void reload()}><RefreshCw className="size-3" />다시 시도</Button></div>}
        {loading && !run && <div className="grid min-h-64 place-items-center text-xs text-zinc-500" role="status"><span className="flex items-center gap-2"><LoaderCircle className="size-4 motion-safe:animate-spin" />Dream 상세를 불러오는 중…</span></div>}
        {!loading && !run && !error && <div className="grid min-h-64 place-items-center text-center text-xs text-zinc-600"><span><FileText className="mx-auto mb-2 size-5" />검사할 Dream 실행을 선택하세요.</span></div>}
        {run && <>
          <div role="tablist" aria-label="Dream 상세 보기" className="mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg bg-black/20 p-1">
            {DREAM_INSPECTOR_TABS.map((item) => <button key={item} id={`dream-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls="dream-inspector-panel" tabIndex={tab === item ? 0 : -1} onClick={() => selectTab(item)} onKeyDown={onTabKeyDown} className={`h-8 shrink-0 rounded-md px-3 text-[11px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 ${tab === item ? "bg-zinc-700 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"}`}>{TAB_COPY[item]}</button>)}
          </div>
          <div id="dream-inspector-panel" role="tabpanel" aria-labelledby={`dream-tab-${tab}`} aria-busy={loading || undefined}>
            {loading && <div className="mb-2 flex items-center gap-1.5 text-[9px] text-zinc-600" role="status"><LoaderCircle className="size-3 motion-safe:animate-spin" />새 snapshot 상세 확인 중</div>}
            {tab === "overview" && <RunOverview run={run} findings={detail?.findings ?? []} onFinding={selectFinding} />}
            {tab === "phases" && <PhasesTab run={run} selectedPhase={selectedPhase} onSelect={selectPhase} />}
            {tab === "comparison" && <ComparisonTab run={run} previousRun={detail?.previousRun ?? null} metrics={detail?.comparison.metrics ?? []} />}
            {tab === "affected" && selectedRunId !== null && <AffectedTab jobId={selectedRunId} baseSearch={typeof window === "undefined" ? "" : window.location.search} affected={detail?.affectedPages ?? { items: [], total: 0, truncated: false, coverage: "unavailable" }} />}
          </div>
        </>}
      </div>
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 px-4 py-2 text-[9px] text-zinc-700"><CheckCircle2 className="size-3" />민감한 원본 실행 정보는 브라우저로 전송하지 않습니다.<span className="ml-auto flex items-center gap-1"><Clock3 className="size-3" />snapshot {formatDate(data.generatedAt)}</span></footer>
  </section>;
}
