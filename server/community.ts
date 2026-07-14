import leiden from "@aflsolutions/graphology-communities-leiden";
import { UndirectedGraph } from "graphology";
import type { RelationFamily } from "../src/types";

export interface CommunitySemanticEdge { source: string; target: string; similarity: number }
export interface CommunityExplicitEdge { source: string; target: string; family: RelationFamily }
export interface LeidenCommunityOptions { resolution?: number; minSemanticSimilarity?: number; seed?: number }

export interface LeidenCommunityResult {
  labels: Record<string, number>;
  strengths: Record<string, number | null>;
  communityCount: number;
  isolatedCount: number;
  modularity: number;
  resolution: number;
  minSemanticSimilarity: number;
  weightedEdgeCount: number;
}

const EXPLICIT_WEIGHTS: Record<RelationFamily, number> = {
  semantic: 0,
  mention: 0.35,
  association: 0.9,
  hierarchy: 1.4,
  provenance: 1.25,
  temporal: 1.1,
  custom: 0.8,
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pairKey(source: string, target: string): string {
  return source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
}

export function semanticCommunityWeight(similarity: number, threshold: number): number {
  if (!Number.isFinite(similarity) || similarity < threshold) return 0;
  const scaled = Math.max(0, Math.min(1, (similarity - threshold) / Math.max(1e-9, 1 - threshold)));
  return 0.25 + scaled * 0.75;
}

export function explicitCommunityWeight(family: RelationFamily): number {
  return EXPLICIT_WEIGHTS[family];
}

export function detectLeidenCommunities(
  nodeIds: string[],
  semanticEdges: CommunitySemanticEdge[],
  explicitEdges: CommunityExplicitEdge[],
  options: LeidenCommunityOptions = {},
): LeidenCommunityResult {
  const resolution = options.resolution ?? 1;
  const minSemanticSimilarity = options.minSemanticSimilarity ?? 0.65;
  const seed = options.seed ?? 84;
  const nodeSet = new Set(nodeIds);
  const pairs = new Map<string, { source: string; target: string; semantic: number; explicit: number }>();

  const getPair = (source: string, target: string) => {
    const key = pairKey(source, target);
    const existing = pairs.get(key);
    if (existing) return existing;
    const ordered = source < target ? { source, target } : { source: target, target: source };
    const created = { ...ordered, semantic: 0, explicit: 0 };
    pairs.set(key, created);
    return created;
  };

  for (const edge of semanticEdges) {
    if (edge.source === edge.target || !nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
    const weight = semanticCommunityWeight(edge.similarity, minSemanticSimilarity);
    if (weight <= 0) continue;
    const pair = getPair(edge.source, edge.target);
    pair.semantic = Math.max(pair.semantic, weight);
  }
  for (const edge of explicitEdges) {
    if (edge.source === edge.target || !nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
    const weight = explicitCommunityWeight(edge.family);
    if (weight <= 0) continue;
    const pair = getPair(edge.source, edge.target);
    pair.explicit = Math.min(2.5, pair.explicit + weight);
  }

  const weightedPairs = [...pairs.values()].map((pair) => ({
    source: pair.source,
    target: pair.target,
    weight: pair.semantic + pair.explicit,
  })).filter((pair) => pair.weight > 0);
  const degree = new Map(nodeIds.map((id) => [id, 0]));
  for (const pair of weightedPairs) {
    degree.set(pair.source, (degree.get(pair.source) ?? 0) + 1);
    degree.set(pair.target, (degree.get(pair.target) ?? 0) + 1);
  }
  const activeNodeIds = nodeIds.filter((id) => (degree.get(id) ?? 0) > 0);
  const isolatedNodeIds = nodeIds.filter((id) => (degree.get(id) ?? 0) === 0);
  if (!activeNodeIds.length) {
    return {
      labels: Object.fromEntries(nodeIds.map((id) => [id, -1])),
      strengths: Object.fromEntries(nodeIds.map((id) => [id, null])),
      communityCount: 0,
      isolatedCount: nodeIds.length,
      modularity: 0,
      resolution,
      minSemanticSimilarity,
      weightedEdgeCount: 0,
    };
  }

  const graph = new UndirectedGraph();
  activeNodeIds.forEach((id) => graph.addNode(id));
  weightedPairs.forEach((pair) => graph.addUndirectedEdge(pair.source, pair.target, { weight: pair.weight }));
  const details = leiden.detailed(graph, {
    weighted: true,
    resolution,
    randomWalk: true,
    rng: mulberry32(seed),
  });
  const normalized = new Map<number, number>();
  for (const id of activeNodeIds) {
    const raw = details.communities[id]!;
    if (!normalized.has(raw)) normalized.set(raw, normalized.size);
  }
  const labels: Record<string, number> = Object.fromEntries(nodeIds.map((id) => [id, -1]));
  activeNodeIds.forEach((id) => { labels[id] = normalized.get(details.communities[id]!)!; });
  isolatedNodeIds.forEach((id) => { labels[id] = -1; });

  const totalWeight = new Map(nodeIds.map((id) => [id, 0]));
  const internalWeight = new Map(nodeIds.map((id) => [id, 0]));
  for (const pair of weightedPairs) {
    totalWeight.set(pair.source, (totalWeight.get(pair.source) ?? 0) + pair.weight);
    totalWeight.set(pair.target, (totalWeight.get(pair.target) ?? 0) + pair.weight);
    if (labels[pair.source] === labels[pair.target]) {
      internalWeight.set(pair.source, (internalWeight.get(pair.source) ?? 0) + pair.weight);
      internalWeight.set(pair.target, (internalWeight.get(pair.target) ?? 0) + pair.weight);
    }
  }
  const strengths = Object.fromEntries(nodeIds.map((id) => {
    const total = totalWeight.get(id) ?? 0;
    return [id, total > 0 ? (internalWeight.get(id) ?? 0) / total : null];
  }));
  return {
    labels,
    strengths,
    communityCount: normalized.size,
    isolatedCount: isolatedNodeIds.length,
    modularity: Number.isFinite(details.modularity) ? details.modularity : 0,
    resolution,
    minSemanticSimilarity,
    weightedEdgeCount: weightedPairs.length,
  };
}
