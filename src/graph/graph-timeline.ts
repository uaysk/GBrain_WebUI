import type { GraphNode, GraphResponse, GraphTimelineNode, GraphTimelineNodeState, GraphTimelineResponse } from "../api/types";
import { endpointId } from "./graph-layers";

export interface GraphTimelineFrame {
  at: string;
  day: string;
  changedNodeIds: ReadonlySet<string>;
  current: boolean;
}

export interface GraphTimelineProjection {
  graph: GraphResponse;
  visibleNodeIds: ReadonlySet<string>;
  changedNodeIds: ReadonlySet<string>;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function timelineStateAt(node: GraphTimelineNode, at: string): GraphTimelineNodeState | null {
  const target = timestamp(at);
  let active: GraphTimelineNodeState | null = null;
  for (const state of node.states) {
    if (timestamp(state.at) > target) break;
    active = state;
  }
  return active;
}

export function createGraphTimelineFrames(timeline: GraphTimelineResponse | null): GraphTimelineFrame[] {
  if (!timeline) return [];
  const end = timestamp(timeline.endAt);
  const byDay = new Map<string, { at: string; ids: Set<string> }>();
  for (const node of timeline.nodes) {
    if (node.static) continue;
    for (const state of node.states) {
      if (timestamp(state.at) > end) continue;
      const day = state.at.slice(0, 10);
      const entry = byDay.get(day) ?? { at: state.at, ids: new Set<string>() };
      if (timestamp(state.at) > timestamp(entry.at)) entry.at = state.at;
      entry.ids.add(node.id);
      byDay.set(day, entry);
    }
  }
  const frames = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, entry]) => ({ at: entry.at, day, changedNodeIds: entry.ids as ReadonlySet<string>, current: false }));
  const currentDay = timeline.endAt.slice(0, 10);
  const existingCurrent = frames.find((frame) => frame.day === currentDay);
  if (existingCurrent) {
    existingCurrent.at = timeline.endAt;
    existingCurrent.current = true;
  } else {
    frames.push({ at: timeline.endAt, day: currentDay, changedNodeIds: new Set<string>(), current: true });
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

export function projectGraphAtFrame(
  graph: GraphResponse,
  timeline: GraphTimelineResponse,
  frame: GraphTimelineFrame,
): GraphTimelineProjection {
  const timelineById = new Map(timeline.nodes.map((node) => [node.id, node]));
  const visibleNodeIds = new Set<string>();
  const nodes = graph.nodes.flatMap((node) => {
    const history = timelineById.get(node.id);
    if (!history || history.static) {
      visibleNodeIds.add(node.id);
      return [node];
    }
    const state = timelineStateAt(history, frame.at);
    if (!state) return [];
    visibleNodeIds.add(node.id);
    return [{ ...node, size: node.size * state.sizeScale }];
  });
  const edgeVisible = (edge: GraphResponse["explicitEdges"][number]) =>
    visibleNodeIds.has(endpointId(edge.source)) && visibleNodeIds.has(endpointId(edge.target));
  const explicitEdges = graph.explicitEdges.filter(edgeVisible);
  const semanticEdges = graph.semanticEdges.filter(edgeVisible);
  const semanticGroups = graph.semanticGroups.map((group) => ({
    ...group,
    count: nodes.filter((node) => node.groupId === group.id).length,
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
        isolatedCount: nodes.filter((node) => node.isUnclassified).length,
      },
      counts: projectedCounts(nodes, explicitEdges, semanticEdges),
    },
    visibleNodeIds,
    changedNodeIds: frame.changedNodeIds,
  };
}
