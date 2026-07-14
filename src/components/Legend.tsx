const shapes = [
  { kind: "circle", label: "concept · circle" },
  { points: "2,2 12,2 12,12 2,12", label: "project · square" },
  { points: "7,1 13,7 7,13 1,7", label: "note · diamond" },
  { points: "7,1 13,12 1,12", label: "incident · triangle" },
  { points: "3,1 11,1 13,7 11,13 3,13 1,7", label: "log · hexagon" },
  { points: "4,1 10,1 13,4 13,10 10,13 4,13 1,10 1,4", label: "receipt · octagon" },
  { points: "7,1 13,6 11,13 3,13 1,6", label: "unknown · pentagon" },
] as const;
const edges = [
  ["semantic · 0.6", "#4CC9D9", "solid", 1],
  ["mention · 1.1", "#4F8FE8", "dotted", 1],
  ["association · 1.6", "#4FAF79", "solid", 2],
  ["structure · 2.6", "#D98A42", "solid", 3],
  ["provenance · 2.0", "#9B72D7", "dashed", 2],
  ["temporal · 3.0", "#D45C5C", "dashed", 3],
];

export function Legend() {
  return (
    <aside className="pointer-events-none absolute left-3 top-3 z-10 w-[min(340px,calc(100vw-24px))] rounded-lg border border-zinc-800 bg-black/85 p-3 text-[10px] text-zinc-300 backdrop-blur-sm" aria-label="Graph legend">
      <div className="mb-2 flex items-center justify-between"><span className="font-semibold uppercase tracking-[0.14em] text-zinc-100">Visual legend</span><span className="text-zinc-500">Color = Leiden community</span></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {shapes.map((shape) => <div key={shape.label} className="flex items-center gap-2">
          <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 fill-zinc-100" aria-hidden="true">
            {"kind" in shape && shape.kind === "circle" ? <circle cx="7" cy="7" r="6" /> : <polygon points={(shape as { points: string }).points} />}
          </svg>
          <span>{shape.label}</span>
        </div>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-zinc-800 pt-2">
        {edges.map(([label, color, style, width]) => <div key={label} className="flex items-center gap-2"><span className="w-6 border-t" style={{ borderColor: color as string, borderTopStyle: style as "solid", borderTopWidth: `${width}px` }} /><span>{label}</span></div>)}
      </div>
      <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-800 pt-2 text-zinc-500">Soft halo = Leiden community · <span className="inline-block size-2 rounded-full bg-[#E8A838]" /> Amber = unclassified</div>
      <div className="mt-1 text-zinc-500">Billboard = always camera-facing · Outline only = no embedding</div>
      <div className="mt-1 text-zinc-500">Direction and bundled types are shown in tooltip</div>
    </aside>
  );
}
