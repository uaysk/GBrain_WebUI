import { History, SlidersHorizontal } from "lucide-react";
import type { RelationFamily } from "../api/types";
import { EXPLICIT_RELATION_FAMILIES, RELATION_VISUALS } from "../graph/visual-spec";
import { Button } from "./ui/button";

interface Props {
  timelineOn: boolean;
  semanticOn: boolean;
  explicitOn: boolean;
  threshold: number;
  minimumThreshold: number;
  explicitFamilies: RelationFamily[];
  onTimelineOnChange: (value: boolean) => void;
  onSemanticOnChange: (value: boolean) => void;
  onExplicitOnChange: (value: boolean) => void;
  onThresholdChange: (value: number) => void;
  onExplicitFamiliesChange: (value: RelationFamily[]) => void;
}

export function LayerControls(props: Props) {
  const toggleFamily = (family: RelationFamily) => props.onExplicitFamiliesChange(
    props.explicitFamilies.includes(family)
      ? props.explicitFamilies.filter((item) => item !== family)
      : [...props.explicitFamilies, family],
  );
  return <aside data-testid="layer-controls" className="pointer-events-auto w-full shrink-0 rounded-lg bg-zinc-900/90 p-3 text-[10px] text-zinc-300 backdrop-blur-sm" aria-label="Graph layers">
    <div className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-[0.14em] text-zinc-100"><SlidersHorizontal className="size-3.5" />Layers</div>
    <div className="flex items-center justify-between gap-3">
      <Button className="h-7 px-2" variant={props.semanticOn ? "active" : "default"} aria-pressed={props.semanticOn} onClick={() => props.onSemanticOnChange(!props.semanticOn)}><span className="size-2 rounded-full bg-cyan-500" />Semantic</Button>
      <label className={`grid min-w-0 flex-1 grid-cols-[auto_minmax(48px,1fr)_2.25rem] items-center gap-2 ${props.semanticOn ? "" : "opacity-40"}`}>
        <span className="text-zinc-500">Similarity</span>
        <input data-testid="semantic-threshold" className="min-w-0 flex-1 accent-cyan-500" type="range" min={props.minimumThreshold} max="1" step="0.01" value={props.threshold} disabled={!props.semanticOn} onChange={(event) => props.onThresholdChange(Number(event.target.value))} />
        <span className="shrink-0 text-right font-mono text-zinc-300">{props.threshold.toFixed(2)}</span>
      </label>
    </div>
    <div className="mt-3 flex items-start gap-2">
      <Button className="h-7 px-2" variant={props.explicitOn ? "active" : "default"} aria-pressed={props.explicitOn} onClick={() => props.onExplicitOnChange(!props.explicitOn)}><span className="size-2 rounded-full bg-amber-500" />Explicit</Button>
      <div className={`flex flex-1 flex-wrap gap-1 ${props.explicitOn ? "" : "opacity-40"}`}>
        {EXPLICIT_RELATION_FAMILIES.filter((family) => family !== "custom").map((family) => <button
          key={family}
          type="button"
          aria-pressed={props.explicitFamilies.includes(family)}
          disabled={!props.explicitOn}
          className={`rounded px-1.5 py-1 leading-none transition-colors focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none ${props.explicitFamilies.includes(family) ? "bg-zinc-700 text-zinc-100" : "bg-black/25 text-zinc-500 hover:bg-zinc-800"}`}
          onClick={() => toggleFamily(family)}
        >{RELATION_VISUALS[family].label.split(" /")[0]}</button>)}
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-black/25 p-1.5 pl-2">
      <div className="flex min-w-0 items-center gap-2"><History className="size-3.5 shrink-0 text-zinc-500" /><div className="min-w-0"><div className="font-medium text-zinc-200">Memory timeline</div><div className="truncate text-[9px] text-zinc-600">하단 기록 재생 컨트롤</div></div></div>
      <Button data-testid="timeline-toggle" className="h-7 shrink-0 px-2" variant={props.timelineOn ? "active" : "default"} aria-pressed={props.timelineOn} onClick={() => props.onTimelineOnChange(!props.timelineOn)}>Timeline {props.timelineOn ? "on" : "off"}</Button>
    </div>
  </aside>;
}
