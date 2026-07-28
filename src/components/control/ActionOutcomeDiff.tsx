import { ArrowRight, CircleDotDashed } from "lucide-react";
import type { ControlActivityRecord, ControlSourceSnapshot } from "../../hooks/useControlExperience";

interface Props {
  record: ControlActivityRecord;
  compact?: boolean;
}

interface MetricDelta {
  label: string;
  before: string;
  after: string;
  delta: number;
  suffix?: string;
  inverse?: boolean;
}

function metricDeltas(before: ControlSourceSnapshot, after: ControlSourceSnapshot): MetricDelta[] {
  return [
    {
      label: "Pages",
      before: before.pages.toLocaleString(),
      after: after.pages.toLocaleString(),
      delta: after.pages - before.pages,
    },
    {
      label: "Chunks",
      before: before.chunksTotal.toLocaleString(),
      after: after.chunksTotal.toLocaleString(),
      delta: after.chunksTotal - before.chunksTotal,
    },
    {
      label: "Embedding 누락",
      before: before.chunksUnembedded.toLocaleString(),
      after: after.chunksUnembedded.toLocaleString(),
      delta: after.chunksUnembedded - before.chunksUnembedded,
      inverse: true,
    },
    {
      label: "Embedding 적용률",
      before: `${before.embeddingCoveragePct.toFixed(1)}%`,
      after: `${after.embeddingCoveragePct.toFixed(1)}%`,
      delta: after.embeddingCoveragePct - before.embeddingCoveragePct,
      suffix: "%p",
    },
  ];
}

export function ActionOutcomeDiff({ record, compact = false }: Props) {
  if (!record.before || !record.after) {
    return <div className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-[10px] text-zinc-500">
      <CircleDotDashed className="size-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
      다음 상태 갱신 후 실행 전후 지표를 비교합니다.
    </div>;
  }

  const metrics = metricDeltas(record.before, record.after);
  return <section className="rounded-lg bg-black/20 p-3" aria-label="관리 작업 실행 전후 비교">
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      <strong className="font-medium text-zinc-300">실행 전후 비교</strong>
      <span className="text-zinc-600">{record.before.sourceName}</span>
      {record.observedJobStatus && <span className="ml-auto rounded bg-zinc-800 px-2 py-0.5 font-mono text-zinc-400">
        {record.observedJobStatus}
      </span>}
    </div>
    <dl className={`mt-2 grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
      {metrics.map((metric) => {
        const effectiveDelta = metric.inverse ? -metric.delta : metric.delta;
        const tone = effectiveDelta > 0 ? "text-emerald-300" : effectiveDelta < 0 ? "text-amber-300" : "text-zinc-600";
        return <div key={metric.label} className="rounded bg-zinc-900/80 px-2.5 py-2">
          <dt className="text-[9px] text-zinc-600">{metric.label}</dt>
          <dd className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px]">
            <span className="truncate text-zinc-500">{metric.before}</span>
            <ArrowRight className="size-3 shrink-0 text-zinc-700" aria-hidden="true" />
            <span className="truncate text-zinc-200">{metric.after}</span>
            <span className={`ml-auto shrink-0 ${tone}`}>
              {metric.delta > 0 ? "+" : ""}{Number.isInteger(metric.delta) ? metric.delta.toLocaleString() : metric.delta.toFixed(1)}{metric.suffix}
            </span>
          </dd>
        </div>;
      })}
    </dl>
  </section>;
}
