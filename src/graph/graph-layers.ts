import type { GraphEdge, GraphNode, GraphResponse, RelationFamily } from "../api/types";
import { RELATION_VISUALS } from "./visual-spec";

export interface GraphLayerSettings {
  semanticOn: boolean;
  explicitOn: boolean;
  minSemanticSimilarity: number;
  explicitFamilies: readonly RelationFamily[];
}

export type RenderEdge = GraphEdge & { bundledEdges: GraphEdge[] };
export interface RelatedGraphNode { node: GraphNode; edges: GraphEdge[] }

export const endpointId = (value: string | GraphNode) => typeof value === "string" ? value : value.id;

export function activeGraphEdges(graph: Pick<GraphResponse, "explicitEdges" | "semanticEdges">, layers: GraphLayerSettings): GraphEdge[] {
  const families = new Set(layers.explicitFamilies);
  const explicit = layers.explicitOn ? graph.explicitEdges.filter((edge) => families.has(edge.family)) : [];
  const semantic = layers.semanticOn
    ? graph.semanticEdges.filter((edge) => (edge.similarity ?? 0) >= layers.minSemanticSimilarity)
    : [];
  return [...explicit, ...semantic];
}

export function bundleGraphEdges(edges: readonly GraphEdge[]): RenderEdge[] {
  const bundles = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = [endpointId(edge.source), endpointId(edge.target)].sort().join("\u0000");
    bundles.set(key, [...(bundles.get(key) ?? []), edge]);
  }
  return [...bundles.values()].map((relations) => {
    const sorted = [...relations].sort((left, right) =>
      RELATION_VISUALS[right.family].priority - RELATION_VISUALS[left.family].priority || left.id.localeCompare(right.id));
    return { ...sorted[0]!, bundledEdges: sorted };
  });
}

export function neighborIdsForNode(selectedId: string | null, edges: readonly GraphEdge[]): Set<string> {
  const focused = new Set<string>();
  if (!selectedId) return focused;
  focused.add(selectedId);
  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    if (source === selectedId) focused.add(target);
    if (target === selectedId) focused.add(source);
  }
  return focused;
}

export function connectedNodeIdsForGroup(
  nodes: Array<Pick<GraphNode, "id" | "groupId">>,
  edges: ReadonlyArray<{ source: string | { id: string }; target: string | { id: string } }>,
  groupId: string,
): Set<string> {
  const members = new Set(nodes.filter((node) => node.groupId === groupId).map((node) => node.id));
  const focused = new Set(members);
  for (const edge of edges) {
    const source = typeof edge.source === "string" ? edge.source : edge.source.id;
    const target = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (members.has(source)) focused.add(target);
    if (members.has(target)) focused.add(source);
  }
  return focused;
}

export function activeConnectionCount(nodeId: string, edges: readonly GraphEdge[]): number {
  const connected = new Set<string>();
  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    if (source === nodeId) connected.add(target);
    if (target === nodeId) connected.add(source);
  }
  return connected.size;
}

export function relatedNodesForNode(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): RelatedGraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    const relatedId = source === nodeId ? target : target === nodeId ? source : null;
    if (!relatedId || relatedId === nodeId || !nodeById.has(relatedId)) continue;
    edgesByNode.set(relatedId, [...(edgesByNode.get(relatedId) ?? []), edge]);
  }
  return [...edgesByNode].map(([relatedId, relations]) => ({
    node: nodeById.get(relatedId)!,
    edges: [...relations].sort((left, right) =>
      RELATION_VISUALS[right.family].priority - RELATION_VISUALS[left.family].priority
      || (right.similarity ?? -1) - (left.similarity ?? -1)
      || left.id.localeCompare(right.id)),
  })).sort((left, right) => {
    const leftPriority = Math.max(...left.edges.map((edge) => RELATION_VISUALS[edge.family].priority));
    const rightPriority = Math.max(...right.edges.map((edge) => RELATION_VISUALS[edge.family].priority));
    return rightPriority - leftPriority || left.node.title.localeCompare(right.node.title) || left.node.id.localeCompare(right.node.id);
  });
}
