import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { NODE_SHAPE_LEGEND, RELATION_VISUALS } from "../graph/visual-spec";

const STORAGE_KEY = "gbrain-memory-map:legend-expanded";
const relationOrder = ["semantic", "mention", "association", "hierarchy", "provenance", "temporal"] as const;
const polygonPoints: Record<string, string> = {
  square: "2,2 12,2 12,12 2,12",
  diamond: "7,1 13,7 7,13 1,7",
  triangle: "7,1 13,12 1,12",
  hexagon: "3,1 11,1 13,7 11,13 3,13 1,7",
  octagon: "4,1 10,1 13,4 13,10 10,13 4,13 1,10 1,4",
  pentagon: "7,1 13,6 11,13 3,13 1,6",
};

function initialExpanded() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function Legend() {
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = () => setExpanded((current) => {
    window.localStorage.setItem(STORAGE_KEY, String(!current));
    return !current;
  });
  return (
    <aside className="pointer-events-auto absolute left-3 top-3 z-30 w-[min(340px,calc(100vw-24px))] rounded-lg bg-zinc-900/90 text-[10px] text-zinc-300 backdrop-blur-sm" aria-label="Graph legend">
      <button
        type="button"
        data-testid="legend-toggle"
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-800 focus-visible:bg-zinc-700 focus-visible:outline-none"
        onClick={toggle}
      >
        <span className="font-semibold uppercase tracking-[0.14em] text-zinc-100">Visual legend</span>
        <span className="flex items-center gap-1.5 text-zinc-500">{expanded ? "Collapse" : "Expand"}{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
      </button>
      {expanded && <div data-testid="legend-content" className="px-3 pb-3 pt-1">
        <div className="mb-1.5 text-zinc-500">Node shape = page type · color = Leiden community</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {NODE_SHAPE_LEGEND.map((item) => <div key={item.shape} className="flex items-center gap-2" title={item.types}>
            <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 fill-zinc-100" aria-hidden="true">
              {item.shape === "circle" ? <circle cx="7" cy="7" r="6" /> : <polygon points={polygonPoints[item.shape]} />}
            </svg>
            <span>{item.label}</span>
          </div>)}
        </div>
        <div className="mt-3 rounded-md bg-black/25 px-2 py-1.5 text-zinc-500">Node size = chunks + total connections</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-black/20 p-2">
          {relationOrder.map((family) => {
            const spec = RELATION_VISUALS[family];
            return <div key={family} className="flex items-center gap-2"><span className="w-6 border-t-2" style={{ borderColor: spec.color, borderTopStyle: spec.dash.length ? "dashed" : "solid" }} /><span>{spec.label}</span></div>;
          })}
        </div>
        <div className="mt-2 rounded-md bg-black/20 px-2 py-1.5 text-zinc-500">Soft halo = community boundary · outline only = no embedding</div>
        <div className="mt-1 text-zinc-500">Hover an edge for direction and bundled relation count</div>
      </div>}
    </aside>
  );
}
