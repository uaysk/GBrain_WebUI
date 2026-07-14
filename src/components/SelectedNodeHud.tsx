import type { GraphNode } from "../api/types";

export function SelectedNodeHud({ node, connectionCount }: { node: GraphNode; connectionCount: number }) {
  return <aside data-testid="selected-summary" className="pointer-events-none absolute bottom-3 right-3 z-30 w-[min(360px,calc(100vw-24px))] rounded-lg bg-zinc-900/95 px-3 py-2.5 text-xs text-zinc-300 backdrop-blur-sm" aria-label="Selected node">
    <div className="truncate font-medium text-zinc-100" title={node.title}>{node.title}</div>
    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
      <span className="text-zinc-500">Type <b className="ml-1 font-normal text-zinc-300">{node.type}</b></span>
      <span className="text-zinc-500">Source <b className="ml-1 font-normal text-zinc-300">{node.sourceName}</b></span>
      <span className="text-zinc-500">Chunks <b className="ml-1 font-mono font-normal text-zinc-300">{node.chunkCount}</b></span>
      <span className="text-zinc-500">Active neighbors <b className="ml-1 font-mono font-normal text-zinc-300">{connectionCount}</b></span>
    </div>
    <div className="mt-1.5 text-[10px] text-zinc-600">Esc or background click to return to the full graph</div>
  </aside>;
}
