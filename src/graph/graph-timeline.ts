import type { GraphNode, GraphResponse, GraphTimelineNode, GraphTimelineNodeState, GraphTimelineResponse } from "../api/types";
import { endpointId } from "./graph-layers";

export interface GraphTimelineFrame {
  at: string;
  day: string;
  changedNodeIds: ReadonlySet<string>;
  createdNodeIds: ReadonlySet<string>;
  updatedNodeIds: ReadonlySet<string>;
  current: boolean;
}

export interface GraphTimelineProjection {
  graph: GraphResponse;
  visibleNodeIds: ReadonlySet<string>;
  changedNodeIds: ReadonlySet<string>;
}

interface IndexedTimelineNode {
  node: GraphTimelineNode;
  timestamps: readonly number[];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function timelineStateAt(node: GraphTimelineNode, at: string): GraphTimelineNodeState | null {
  return stateAtTimestamp({ node, timestamps: node.states.map((state) => timestamp(state.at)) }, timestamp(at));
}

function stateAtTimestamp(indexed: IndexedTimelineNode, target: number): GraphTimelineNodeState | null {
  let low = 0;
  let high = indexed.timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indexed.timestamps[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? null : indexed.node.states[low - 1] ?? null;
}

export function createGraphTimelineFrames(timeline: GraphTimelineResponse | null): GraphTimelineFrame[] {
  if (!timeline) return [];
  const end = timestamp(timeline.endAt);
  const byDay = new Map<string, {
    at: string;
    ids: Set<string>;
    createdIds: Set<string>;
    updatedIds: Set<string>;
  }>();
  for (const node of timeline.nodes) {
    if (node.static) continue;
    for (const [stateIndex, state] of node.states.entries()) {
      if (timestamp(state.at) > end) continue;
      const day = state.at.slice(0, 10);
      const entry = byDay.get(day) ?? {
        at: state.at,
        ids: new Set<string>(),
        createdIds: new Set<string>(),
        updatedIds: new Set<string>(),
      };
      if (timestamp(state.at) > timestamp(entry.at)) entry.at = state.at;
      entry.ids.add(node.id);
      if (stateIndex === 0) entry.createdIds.add(node.id);
      else entry.updatedIds.add(node.id);
      byDay.set(day, entry);
    }
  }
  const frames = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, entry]) => ({
      at: entry.at,
      day,
      changedNodeIds: entry.ids as ReadonlySet<string>,
      createdNodeIds: entry.createdIds as ReadonlySet<string>,
      updatedNodeIds: entry.updatedIds as ReadonlySet<string>,
      current: false,
    }));
  const currentDay = timeline.endAt.slice(0, 10);
  const existingCurrent = frames.find((frame) => frame.day === currentDay);
  if (existingCurrent) {
    existingCurrent.at = timeline.endAt;
    existingCurrent.current = true;
  } else {
    frames.push({
      at: timeline.endAt,
      day: currentDay,
      changedNodeIds: new Set<string>(),
      createdNodeIds: new Set<string>(),
      updatedNodeIds: new Set<string>(),
      current: true,
    });
  }
  return frames;
}

function projectedCounts(nodes: GraphNode[], explicitEdges: GraphResponse["explicitEdges"], semanticEdges: GraphResponse["semanticEdges"]): GraphResponse["counts"] {
  const embeddedPages = nodes.filter((node) => node.hasEmbedding).length;
  const unembeddedPages = nodes.length - embeddedPages;
  return {
    pages: nodes.length,
    chunks: nodes.reduce((sum, node) => sum + node.chunkCount, 0),
    links: explicitEdges.length,
    explicitEdges: explicitEdges.length,
    semanticEdges: semanticEdges.length,
    embeddedPages,
    unembeddedPages,
    unclassifiedPages: nodes.filter((node) => node.isUnclassified).length,
    embeddingCoverage: nodes.length ? embeddedPages / nodes.length : 0,
  };
}

export class GraphTimelineIndex {
  private readonly timelineById: ReadonlyMap<string, IndexedTimelineNode>;

  constructor(readonly timeline: GraphTimelineResponse) {
    this.timelineById = new Map(timeline.nodes.map((node) => [node.id, {
      node,
      timestamps: node.states.map((state) => timestamp(state.at)),
    }]));
  }

  project(graph: GraphResponse, frame: GraphTimelineFrame): GraphTimelineProjection {
    const target = timestamp(frame.at);
    const visibleNodeIds = new Set<string>();
    const nodes: GraphNode[] = [];
    const groupCounts = new Map<string, number>();
    let isolatedCount = 0;
    for (const node of graph.nodes) {
      const history = this.timelineById.get(node.id);
      let projected: GraphNode | null = node;
      if (history && !history.node.static) {
        const state = stateAtTimestamp(history, target);
        projected = state ? { ...node, size: node.size * state.sizeScale } : null;
      }
      if (!projected) continue;
      nodes.push(projected);
      visibleNodeIds.add(projected.id);
      groupCounts.set(projected.groupId, (groupCounts.get(projected.groupId) ?? 0) + 1);
      if (projected.isUnclassified) isolatedCount += 1;
    }
    const edgeVisible = (edge: GraphResponse["explicitEdges"][number]) =>
      visibleNodeIds.has(endpointId(edge.source)) && visibleNodeIds.has(endpointId(edge.target));
    const explicitEdges = graph.explicitEdges.filter(edgeVisible);
    const semanticEdges = graph.semanticEdges.filter(edgeVisible);
    const semanticGroups = graph.semanticGroups.map((group) => ({
      ...group,
      count: groupCounts.get(group.id) ?? 0,
    }));
    return {
      graph: {
        ...graph,
        nodes,
        explicitEdges,
        semanticEdges,
        semanticGroups,
        communityDetection: {
          ...graph.communityDetection,
          communityCount: semanticGroups.filter((group) => group.kind === "community" && group.count > 0).length,
          isolatedCount,
        },
        counts: projectedCounts(nodes, explicitEdges, semanticEdges),
      },
      visibleNodeIds,
      changedNodeIds: frame.changedNodeIds,
    };
  }
}

export function projectGraphAtFrame(
  graph: GraphResponse,
  timeline: GraphTimelineResponse,
  frame: GraphTimelineFrame,
): GraphTimelineProjection {
  return new GraphTimelineIndex(timeline).project(graph, frame);
}
