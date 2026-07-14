import { lazy, Suspense, useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import type { GraphEdge, GraphNode } from "../api/types";
import type { RelatedGraphNode } from "../graph/graph-layers";
import { endpointId } from "../graph/graph-layers";
import { RELATION_VISUALS } from "../graph/visual-spec";
import type { NodeDetailState } from "../hooks/useNodeDetail";

const MarkdownContent = lazy(() => import("./MarkdownContent").then((module) => ({ default: module.MarkdownContent })));
const MarkdownDocumentDialog = lazy(() => import("./MarkdownDocumentDialog").then((module) => ({ default: module.MarkdownDocumentDialog })));

interface Props {
  node: GraphNode;
  detailState: NodeDetailState;
  relatedNodes: RelatedGraphNode[];
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

function relationLabel(edge: GraphEdge, selectedId: string): string {
  if (edge.kind === "semantic") return `Similarity ${(edge.similarity ?? 0).toFixed(2)}`;
  const label = RELATION_VISUALS[edge.family].label.split(" /")[0];
  if (!edge.directed) return label;
  return endpointId(edge.source) === selectedId ? `${label} →` : `← ${label}`;
}

export function NodeContextPanel({ node, detailState, relatedNodes, onSelectNode, onClose }: Props) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const currentDetail = detailState.nodeId === node.id && detailState.status === "ready" ? detailState.detail : null;
  const status = detailState.nodeId === node.id ? detailState.status : "loading";
  useEffect(() => { setContentExpanded(false); }, [node.id]);

  return <><aside
    data-testid="node-context-panel"
    className="pointer-events-auto flex h-[calc(100dvh-250px)] min-h-[320px] max-h-[750px] w-full flex-col overflow-hidden rounded-lg bg-zinc-900/95 text-[10px] text-zinc-300 backdrop-blur-sm"
    aria-label="Selected node context"
  >
    <div data-testid="selected-summary" className="shrink-0 px-3 py-2.5" aria-label="Selected node">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: node.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-zinc-100" title={node.title}>{node.title}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-zinc-500">
            <span>Type <b className="ml-1 font-normal text-zinc-300">{node.type}</b></span>
            <span className="truncate">Source <b className="ml-1 font-normal text-zinc-300">{node.sourceName}</b></span>
            <span>Chunks <b className="ml-1 font-mono font-normal text-zinc-300">{node.chunkCount}</b></span>
            <span>Active neighbors <b className="ml-1 font-mono font-normal text-zinc-300">{relatedNodes.length}</b></span>
          </div>
        </div>
        <button type="button" className="grid size-6 shrink-0 place-items-center rounded-md bg-black/20 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none" aria-label="Close node context" onClick={onClose}><X className="size-3.5" /></button>
      </div>
    </div>

    <section className="mx-2 shrink-0 overflow-hidden rounded-md bg-black/20" aria-labelledby="node-content-heading">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <h2 id="node-content-heading" className="font-semibold uppercase tracking-[0.12em] text-zinc-400">Content</h2>
        <div className="flex min-w-0 items-center gap-2">
          {currentDetail?.updatedAt && <span className="truncate text-zinc-600">Updated {new Date(currentDetail.updatedAt).toLocaleDateString()}</span>}
          <button
            type="button"
            disabled={!currentDetail}
            aria-label="Expand page content"
            onClick={() => setContentExpanded(true)}
            className="flex h-6 shrink-0 items-center gap-1 rounded bg-zinc-800 px-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
          ><Maximize2 className="size-3" />Expand</button>
        </div>
      </div>
      <div data-testid="node-content" data-state={status} className="max-h-[24dvh] min-h-20 overflow-y-auto break-words px-2 pb-2 text-[10px] leading-relaxed text-zinc-400">
        {status === "loading" && <span className="text-zinc-600">Loading content…</span>}
        {status === "failed" && <span className="text-red-300">{detailState.error}</span>}
        {currentDetail && <Suspense fallback={<span className="text-zinc-600">Rendering Markdown…</span>}><MarkdownContent content={currentDetail.content || "No text content"} compact testId="compact-markdown-content" /></Suspense>}
        {currentDetail?.contentTruncated && <span className="mt-2 block text-amber-300">Content is truncated after 64,000 characters.</span>}
      </div>
    </section>

    <section className="mt-2 flex min-h-0 flex-1 flex-col px-2 pb-2" aria-labelledby="related-nodes-heading">
      <div className="flex shrink-0 items-center justify-between px-1 pb-1.5">
        <h2 id="related-nodes-heading" className="font-semibold uppercase tracking-[0.12em] text-zinc-400">Related nodes</h2>
        <span className="font-mono text-zinc-500">{relatedNodes.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="related-node-list">
        {!relatedNodes.length && <div className="rounded-md bg-black/15 px-2 py-3 text-center text-zinc-600">No related nodes in active layers</div>}
        {relatedNodes.map(({ node: related, edges }) => <button
          key={related.id}
          type="button"
          data-related-node={related.id}
          className="mb-1 block w-full rounded-md bg-black/20 px-2 py-1.5 text-left last:mb-0 hover:bg-zinc-800 focus-visible:bg-zinc-700 focus-visible:outline-none"
          onClick={() => onSelectNode(related.id)}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: related.color }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200" title={related.title}>{related.title}</span>
            {edges.length > 1 && <span className="shrink-0 font-mono text-zinc-500">{edges.length} links</span>}
          </div>
          <div className="mt-0.5 truncate pl-4 text-zinc-500">{edges.slice(0, 2).map((edge) => relationLabel(edge, node.id)).join(" · ")}{edges.length > 2 ? ` · +${edges.length - 2}` : ""}</div>
        </button>)}
      </div>
    </section>
    <div className="shrink-0 bg-black/15 px-3 py-2 text-zinc-600">Select a related node to continue · Esc or background click to close</div>
  </aside>
    {contentExpanded && currentDetail && <Suspense fallback={null}><MarkdownDocumentDialog node={node} detail={currentDetail} onClose={() => setContentExpanded(false)} /></Suspense>}
  </>;
}
