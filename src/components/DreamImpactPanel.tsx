import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import type { ControlDreamRunDetail, GraphNode, GraphResponse } from "../api/types";

interface Props {
  jobId: number;
  graph: GraphResponse;
  detail: ControlDreamRunDetail | null;
  loading: boolean;
  error: string | null;
  embedded?: boolean;
  onRetry: () => void;
  onSelectNode: (id: string) => void;
  onOpenControl: () => void;
  onClose: () => void;
}

export function affectedGraphNodes(
  graph: Pick<GraphResponse, "nodes">,
  detail: ControlDreamRunDetail | null,
): { nodes: GraphNode[]; nodeIds: ReadonlySet<string>; missingCount: number } {
  if (!detail) return { nodes: [], nodeIds: new Set(), missingCount: 0 };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = detail.affectedPages.items.flatMap((item) => {
    const node = byId.get(`${item.sourceId}::${item.slug}`);
    return node ? [node] : [];
  });
  return {
    nodes,
    nodeIds: new Set(nodes.map((node) => node.id)),
    missingCount: Math.max(0, detail.affectedPages.total - nodes.length),
  };
}

export function DreamImpactPanel(props: Props) {
  const impact = useMemo(() => affectedGraphNodes(props.graph, props.detail), [props.detail, props.graph]);
  const containerClass = props.embedded
    ? "w-full overflow-hidden rounded-lg bg-zinc-900 text-[10px] text-zinc-300"
    : "pointer-events-auto absolute bottom-3 left-3 z-30 hidden max-h-[min(52dvh,520px)] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-lg bg-zinc-900/95 text-[10px] text-zinc-300 shadow-2xl backdrop-blur-sm md:flex md:flex-col";
  return <aside data-testid="dream-impact-panel" className={containerClass} aria-label={`Dream ${props.jobId} 영향 페이지`}>
    <header className="flex shrink-0 items-start gap-2 px-3 py-2.5">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-fuchsia-400" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-zinc-100">Dream #{props.jobId} impact</div>
        <div className="mt-0.5 text-zinc-500">현재 graph snapshot과 안전하게 대조한 결과</div>
      </div>
      <button type="button" aria-label="Dream 영향 강조 닫기" onClick={props.onClose} className="grid size-7 shrink-0 place-items-center rounded bg-black/25 text-zinc-500 hover:bg-zinc-700 hover:text-white focus-visible:bg-zinc-600 focus-visible:outline-none"><X className="size-3.5" /></button>
    </header>
    {props.loading && !props.detail && <div className="flex items-center gap-2 px-3 py-5 text-zinc-500"><RefreshCw className="size-3.5 animate-spin" />영향 페이지를 불러오는 중…</div>}
    {props.error && !props.detail && <div className="mx-3 mb-3 rounded bg-amber-950/50 p-2.5 text-amber-200">
      <div className="flex gap-2"><AlertTriangle className="size-3.5 shrink-0" /><span>{props.error}</span></div>
      <button type="button" onClick={props.onRetry} className="mt-2 rounded bg-black/20 px-2 py-1 text-amber-100 focus-visible:bg-amber-900 focus-visible:outline-none">다시 시도</button>
    </div>}
    {props.detail && <>
      {props.detail.affectedPages.coverage !== "complete" && <p className="mx-3 mb-2 rounded bg-amber-950/25 px-2 py-1.5 leading-relaxed text-amber-200/75" role="status">{props.detail.affectedPages.coverage === "partial" ? "구조화된 legacy ref만 강조합니다. 일부 Dream 단계의 영향은 빠질 수 있습니다." : "이 report에서는 안전하게 식별 가능한 page ref가 없어 원문에서 대상을 추측하지 않습니다."}</p>}
      <div className="mx-3 grid grid-cols-3 gap-1.5 rounded bg-black/20 p-2 text-center">
        <div><strong className="block font-mono text-sm text-fuchsia-300">{props.detail.affectedPages.total}</strong><span className="text-zinc-600">identified</span></div>
        <div><strong className="block font-mono text-sm text-emerald-300">{impact.nodes.length}</strong><span className="text-zinc-600">on map</span></div>
        <div><strong className="block font-mono text-sm text-amber-300">{impact.missingCount}</strong><span className="text-zinc-600">not shown</span></div>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-2">
        {!impact.nodes.length && <div className="rounded bg-black/15 px-2 py-4 text-center text-zinc-600">현재 graph에 표시할 영향 페이지가 없습니다.</div>}
        {impact.nodes.map((node) => {
          const page = props.detail!.affectedPages.items.find((item) => `${item.sourceId}::${item.slug}` === node.id);
          return <button key={node.id} type="button" onClick={() => props.onSelectNode(node.id)} className="mb-1 block min-h-11 w-full rounded bg-black/20 px-2 py-1.5 text-left hover:bg-zinc-800 focus-visible:bg-zinc-700 focus-visible:outline-none">
            <span className="block truncate text-[11px] text-zinc-200">{node.title}</span>
            <span className="mt-0.5 block truncate text-zinc-500">{page?.phases.join(" · ") || node.slug}</span>
          </button>;
        })}
        {impact.missingCount > 0 && <p className="mt-2 rounded bg-amber-950/25 px-2 py-1.5 leading-relaxed text-amber-300/75">{impact.missingCount}개 ref는 삭제되었거나 현재 snapshot·source allowlist에서 표시되지 않을 수 있습니다.{props.detail.affectedPages.truncated ? " 안전한 목록 상한에서 일부가 잘렸습니다." : ""}</p>}
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-zinc-800 px-3 py-2">
        <button type="button" onClick={props.onOpenControl} className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 focus-visible:bg-zinc-600 focus-visible:outline-none"><ArrowLeft className="size-3" />Inspector</button>
        <span className="flex items-center gap-1 text-zinc-600"><ExternalLink className="size-3" />{props.detail.stale ? "stale detail" : "same polling snapshot"}</span>
      </footer>
    </>}
  </aside>;
}
