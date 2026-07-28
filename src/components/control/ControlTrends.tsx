import { Activity, CalendarRange, ChartNoAxesCombined, Clock3, DatabaseZap } from "lucide-react";
import { useMemo, useState } from "react";
import type { ControlJob, ControlSourceStatus } from "../../types";
import type { ControlTrendPoint } from "../../hooks/useControlExperience";
import { Button } from "../ui/button";

interface Props {
  generatedAt: string;
  sources: ControlSourceStatus[];
  jobs: ControlJob[];
  points: ControlTrendPoint[];
}

interface AggregatePoint {
  at: string;
  pages: number;
  chunksTotal: number;
  chunksUnembedded: number;
  coverage: number;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDuration(value: number): string {
  if (!value) return "—";
  if (value < 60_000) return `${Math.round(value / 1_000)}초`;
  return `${Math.floor(value / 60_000)}분 ${Math.round((value % 60_000) / 1_000)}초`;
}

function aggregatePoints(points: ControlTrendPoint[], sourceId: string): AggregatePoint[] {
  if (sourceId !== "all") {
    return points
      .filter((point) => point.sourceId === sourceId)
      .map((point) => ({
        at: point.at,
        pages: point.pages,
        chunksTotal: point.chunksTotal,
        chunksUnembedded: point.chunksUnembedded,
        coverage: point.embeddingCoveragePct,
      }))
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  }

  const buckets = new Map<string, ControlTrendPoint[]>();
  for (const point of points) {
    const bucket = buckets.get(point.at) ?? [];
    bucket.push(point);
    buckets.set(point.at, bucket);
  }
  return [...buckets].map(([at, bucket]) => {
    const chunksTotal = bucket.reduce((sum, point) => sum + point.chunksTotal, 0);
    const chunksUnembedded = bucket.reduce((sum, point) => sum + point.chunksUnembedded, 0);
    return {
      at,
      pages: bucket.reduce((sum, point) => sum + point.pages, 0),
      chunksTotal,
      chunksUnembedded,
      coverage: chunksTotal > 0 ? ((chunksTotal - chunksUnembedded) / chunksTotal) * 100 : 0,
    };
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function polyline(values: number[]): string {
  if (!values.length) return "";
  const width = 300;
  const height = 72;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 6 - ((value - minimum) / span) * (height - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  const tone = value > 0 ? "text-emerald-300" : value < 0 ? "text-amber-300" : "text-zinc-500";
  const sign = value > 0 ? "+" : "";
  return <span className={`font-mono text-[10px] ${tone}`}>{sign}{Number.isInteger(value) ? formatNumber(value) : value.toFixed(1)}{suffix}</span>;
}

function Sparkline({
  label,
  values,
  value,
  delta,
  suffix = "",
  inverseDelta = false,
}: {
  label: string;
  values: number[];
  value: string;
  delta: number;
  suffix?: string;
  inverseDelta?: boolean;
}) {
  const adjustedDelta = inverseDelta ? -delta : delta;
  return <article className="rounded-lg bg-black/20 p-3">
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">{label}</div>
        <div className="mt-1 font-mono text-lg font-semibold text-zinc-100">{value}</div>
      </div>
      <Delta value={adjustedDelta} suffix={suffix} />
    </div>
    {values.length > 1 ? <svg
      className="mt-3 h-16 w-full overflow-visible"
      viewBox="0 0 300 72"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} 관찰 추세, ${values.length}개 표본`}
    >
      <line x1="0" x2="300" y1="66" y2="66" stroke="rgb(63 63 70)" strokeWidth="1" />
      <polyline
        points={polyline(values)}
        fill="none"
        stroke="rgb(34 211 238)"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg> : <div className="mt-3 grid h-16 place-items-center rounded bg-zinc-900/60 text-[10px] text-zinc-600">
      다음 관찰부터 추세가 그려집니다
    </div>}
  </article>;
}

export function ControlTrends({ generatedAt, sources, jobs, points }: Props) {
  const [days, setDays] = useState<7 | 30>(7);
  const [sourceId, setSourceId] = useState("all");
  const cutoff = Date.parse(generatedAt) - days * 24 * 60 * 60 * 1_000;
  const visiblePoints = useMemo(() =>
    aggregatePoints(points.filter((point) => Date.parse(point.at) >= cutoff), sourceId),
  [cutoff, points, sourceId]);
  const visibleJobs = useMemo(() => jobs.filter((job) => {
    const timestamp = Date.parse(job.finishedAt ?? job.startedAt ?? job.createdAt ?? "");
    return Number.isFinite(timestamp) && timestamp >= cutoff && (sourceId === "all" || job.sourceId === sourceId);
  }), [cutoff, jobs, sourceId]);

  const first = visiblePoints[0];
  const latest = visiblePoints.at(-1);
  const terminalJobs = visibleJobs.filter((job) => ["completed", "failed", "dead", "cancelled"].includes(job.status));
  const successfulJobs = terminalJobs.filter((job) => job.status === "completed").length;
  const failedJobs = terminalJobs.filter((job) => ["failed", "dead"].includes(job.status)).length;
  const durationJobs = terminalJobs.filter((job) => job.durationMs > 0);
  const averageDuration = durationJobs.length
    ? durationJobs.reduce((sum, job) => sum + job.durationMs, 0) / durationJobs.length
    : 0;
  const successRate = terminalJobs.length ? (successfulJobs / terminalJobs.length) * 100 : null;

  return <section className="overflow-hidden rounded-xl bg-zinc-900/70" aria-labelledby="control-trends-title">
    <header className="flex flex-wrap items-center gap-3 bg-zinc-900 px-4 py-3">
      <span className="grid size-8 place-items-center rounded-lg bg-zinc-800 text-cyan-300">
        <ChartNoAxesCombined className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="control-trends-title" className="text-xs font-semibold text-zinc-100">운영 추세</h2>
        <p className="mt-0.5 text-[10px] text-zinc-500">이 브라우저가 관찰한 정규화 지표를 비교합니다.</p>
      </div>
      <label className="sr-only" htmlFor="control-trend-source">추세 Source</label>
      <select
        id="control-trend-source"
        value={sourceId}
        onChange={(event) => setSourceId(event.target.value)}
        className="h-8 max-w-44 rounded-md border-0 bg-zinc-800 px-2.5 text-[11px] text-zinc-300 outline-none focus:ring-1 focus:ring-cyan-500"
      >
        <option value="all">모든 Source</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
      <div className="flex rounded-md bg-zinc-800 p-0.5" aria-label="추세 기간">
        {([7, 30] as const).map((period) => <Button
          key={period}
          type="button"
          variant={days === period ? "active" : "ghost"}
          className="h-7 px-2.5 text-[10px]"
          aria-pressed={days === period}
          onClick={() => setDays(period)}
        >{period}일</Button>)}
      </div>
    </header>
    <div className="space-y-3 p-3 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Sparkline
          label="Embedding 적용률"
          values={visiblePoints.map((point) => point.coverage)}
          value={latest ? `${latest.coverage.toFixed(1)}%` : "—"}
          delta={latest && first ? latest.coverage - first.coverage : 0}
          suffix="%p"
        />
        <Sparkline
          label="Pages"
          values={visiblePoints.map((point) => point.pages)}
          value={latest ? formatNumber(latest.pages) : "—"}
          delta={latest && first ? latest.pages - first.pages : 0}
        />
        <Sparkline
          label="Embedding 누락"
          values={visiblePoints.map((point) => point.chunksUnembedded)}
          value={latest ? formatNumber(latest.chunksUnembedded) : "—"}
          delta={latest && first ? latest.chunksUnembedded - first.chunksUnembedded : 0}
          inverseDelta
        />
        <article className="rounded-lg bg-black/20 p-3">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Activity className="size-3" aria-hidden="true" />Job 성공률
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-zinc-100">{successRate === null ? "—" : `${successRate.toFixed(0)}%`}</div>
          <div
            className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-800"
            role="img"
            aria-label={`완료 ${successfulJobs}, 실패 ${failedJobs}, 기타 ${Math.max(terminalJobs.length - successfulJobs - failedJobs, 0)}`}
          >
            {terminalJobs.length > 0 && <>
              <span className="bg-emerald-500" style={{ width: `${(successfulJobs / terminalJobs.length) * 100}%` }} />
              <span className="bg-red-500" style={{ width: `${(failedJobs / terminalJobs.length) * 100}%` }} />
            </>}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-zinc-500">
            <span>완료 <b className="font-mono font-normal text-emerald-300">{successfulJobs}</b></span>
            <span>실패 <b className="font-mono font-normal text-red-300">{failedJobs}</b></span>
            <span>표본 <b className="font-mono font-normal text-zinc-300">{terminalJobs.length}</b></span>
          </div>
        </article>
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-black/15 px-3 py-2 text-[10px] text-zinc-600">
        <span className="flex items-center gap-1.5"><CalendarRange className="size-3" aria-hidden="true" />관찰 표본 {visiblePoints.length}개</span>
        <span className="flex items-center gap-1.5"><Clock3 className="size-3" aria-hidden="true" />평균 Job 소요 {formatDuration(averageDuration)}</span>
        <span className="flex items-center gap-1.5"><DatabaseZap className="size-3" aria-hidden="true" />브라우저별 최대 30일 보존</span>
        <span className="ml-auto text-zinc-700">장기 서버 통계가 아닌 현재 브라우저의 관찰 데이터입니다.</span>
      </footer>
    </div>
  </section>;
}
