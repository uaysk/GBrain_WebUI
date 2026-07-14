import type { GraphNode, SemanticGroup } from "../api/types";
import { communityLabelTitle } from "../graph/community-label";

interface Props {
  group: SemanticGroup;
  nodes: GraphNode[];
  onSelectNode: (id: string) => void;
}

export function CommunityNodeList({ group, nodes, onSelectNode }: Props) {
  const sortedNodes = [...nodes].sort((left, right) =>
    left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

  return <aside
    data-testid="community-node-list"
    className="pointer-events-auto flex max-h-[calc(100dvh-250px)] min-h-0 w-full flex-col overflow-hidden rounded-lg bg-zinc-900/95 text-[10px] text-zinc-300 backdrop-blur-sm"
    aria-label="Focused community nodes"
  >
    <div className="shrink-0 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-zinc-100" title={communityLabelTitle(group.label)}>{communityLabelTitle(group.label)}</div>
          <div className="mt-0.5 text-zinc-500"><span className="font-mono text-zinc-300">{nodes.length}</span> nodes inside halo</div>
        </div>
      </div>
    </div>
    <div className="min-h-0 overflow-y-auto px-2 pb-2" data-testid="community-node-scroll">
      {sortedNodes.map((node) => <button
        key={node.id}
        type="button"
        data-community-node={node.id}
        className="mb-1 block w-full rounded-md bg-black/20 px-2 py-1.5 text-left last:mb-0 hover:bg-zinc-800 focus-visible:bg-zinc-700 focus-visible:outline-none"
        onClick={() => onSelectNode(node.id)}
      >
        <div className="truncate text-[11px] text-zinc-200" title={node.title}>{node.title}</div>
        <div className="mt-0.5 flex items-center justify-between gap-3 text-zinc-500">
          <span className="truncate">{node.type}</span>
          <span className="shrink-0 font-mono">{node.chunkCount} chunks</span>
        </div>
      </button>)}
    </div>
    <div className="shrink-0 bg-black/15 px-3 py-2 text-zinc-600">Esc or background click to close</div>
  </aside>;
}
