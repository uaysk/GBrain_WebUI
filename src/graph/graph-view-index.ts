import type { GraphEdge, GraphNode, GraphResponse } from "../api/types";
import { RELATION_VISUALS } from "./visual-spec";
import { endpointId, type GraphLayerSettings, type RelatedGraphNode } from "./graph-layers";

interface ActiveView {
  edges: readonly GraphEdge[];
  edgeIds: ReadonlySet<string>;
}

function layerKey(layers: GraphLayerSettings): string {
  return [
    layers.semanticOn ? "1" : "0",
    layers.explicitOn ? "1" : "0",
    layers.minSemanticSimilarity.toFixed(6),
    [...layers.explicitFamilies].sort().join(","),
  ].join("|");
}

export class GraphViewIndex {
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  private readonly edgesByNode = new Map<string, GraphEdge[]>();
  private readonly nodesByGroup = new Map<string, GraphNode[]>();
  private readonly activeViews = new Map<string, ActiveView>();

  constructor(readonly graph: GraphResponse) {
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes) {
      const members = this.nodesByGroup.get(node.groupId);
      if (members) members.push(node);
      else this.nodesByGroup.set(node.groupId, [node]);
    }
    for (const edge of [...graph.explicitEdges, ...graph.semanticEdges]) {
      const source = endpointId(edge.source);
      const target = endpointId(edge.target);
      const sourceEdges = this.edgesByNode.get(source);
      if (sourceEdges) sourceEdges.push(edge);
      else this.edgesByNode.set(source, [edge]);
      if (target !== source) {
        const targetEdges = this.edgesByNode.get(target);
        if (targetEdges) targetEdges.push(edge);
        else this.edgesByNode.set(target, [edge]);
      }
    }
  }

  active(layers: GraphLayerSettings): ActiveView {
    const key = layerKey(layers);
    const cached = this.activeViews.get(key);
    if (cached) return cached;
    const families = new Set(layers.explicitFamilies);
    const edges = [
      ...(layers.explicitOn ? this.graph.explicitEdges.filter((edge) => families.has(edge.family)) : []),
      ...(layers.semanticOn
        ? this.graph.semanticEdges.filter((edge) => (edge.similarity ?? 0) >= layers.minSemanticSimilarity)
        : []),
    ];
    const view = { edges, edgeIds: new Set(edges.map((edge) => edge.id)) };
    this.activeViews.set(key, view);
    return view;
  }

  neighbors(nodeId: string | null, active: ActiveView): Set<string> {
    const neighbors = new Set<string>();
    if (!nodeId) return neighbors;
    neighbors.add(nodeId);
    for (const edge of this.edgesByNode.get(nodeId) ?? []) {
      if (!active.edgeIds.has(edge.id)) continue;
      neighbors.add(endpointId(edge.source));
      neighbors.add(endpointId(edge.target));
    }
    return neighbors;
  }

  related(nodeId: string, active: ActiveView): RelatedGraphNode[] {
    const edgesByRelatedNode = new Map<string, GraphEdge[]>();
    for (const edge of this.edgesByNode.get(nodeId) ?? []) {
      if (!active.edgeIds.has(edge.id)) continue;
      const source = endpointId(edge.source);
      const target = endpointId(edge.target);
      const relatedId = source === nodeId ? target : source;
      if (relatedId === nodeId || !this.nodeById.has(relatedId)) continue;
      const relations = edgesByRelatedNode.get(relatedId);
      if (relations) relations.push(edge);
      else edgesByRelatedNode.set(relatedId, [edge]);
    }
    return [...edgesByRelatedNode].map(([relatedId, relations]) => ({
      node: this.nodeById.get(relatedId)!,
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

  groupNodes(groupId: string, embeddedOnly = false): readonly GraphNode[] {
    const members = this.nodesByGroup.get(groupId) ?? [];
    return embeddedOnly ? members.filter((node) => node.hasEmbedding) : members;
  }

  connectedToGroup(groupId: string, active: ActiveView): Set<string> {
    const members = new Set(this.groupNodes(groupId).map((node) => node.id));
    const connected = new Set(members);
    for (const member of members) {
      for (const edge of this.edgesByNode.get(member) ?? []) {
        if (!active.edgeIds.has(edge.id)) continue;
        connected.add(endpointId(edge.source));
        connected.add(endpointId(edge.target));
      }
    }
    return connected;
  }
}
