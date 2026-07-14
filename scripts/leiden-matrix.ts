import { detectLeidenCommunities } from "../server/community";
import type { GraphResponse } from "../src/types";

const path = process.argv[2] ?? "/tmp/gbrain-graph.json";
const graph = await Bun.file(path).json() as GraphResponse;
const endpoint = (value: string | { id: string }) => typeof value === "string" ? value : value.id;
const semanticEdges = graph.semanticEdges.map((edge) => ({ source: endpoint(edge.source), target: endpoint(edge.target), similarity: edge.similarity! }));
const explicitEdges = graph.explicitEdges.map((edge) => ({ source: endpoint(edge.source), target: endpoint(edge.target), family: edge.family }));

const agreement = (left: Record<string, number>, right: Record<string, number>) => {
  let matching = 0; let pairs = 0;
  for (let i = 0; i < graph.nodes.length; i += 1) for (let j = i + 1; j < graph.nodes.length; j += 1) {
    const a = graph.nodes[i]!.id; const b = graph.nodes[j]!.id;
    if (left[a] < 0 || left[b] < 0 || right[a] < 0 || right[b] < 0) continue;
    matching += (left[a] === left[b]) === (right[a] === right[b]) ? 1 : 0;
    pairs += 1;
  }
  return pairs ? matching / pairs : 1;
};

const results = [];
for (const minSemanticSimilarity of [0.65, 0.7, 0.75]) {
  for (const resolution of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
    const runs = [42, 84, 126].map((seed) => detectLeidenCommunities(
      graph.nodes.map((node) => node.id), semanticEdges, explicitEdges, { minSemanticSimilarity, resolution, seed },
    ));
    const selected = runs[1]!;
    const sizes = Array.from({ length: selected.communityCount }, (_, community) => Object.values(selected.labels).filter((label) => label === community).length).sort((a, b) => b - a);
    const strengths = Object.values(selected.strengths).filter((value): value is number => value !== null).sort((a, b) => a - b);
    results.push({
      minSemanticSimilarity,
      resolution,
      communities: selected.communityCount,
      isolated: selected.isolatedCount,
      edges: selected.weightedEdgeCount,
      modularity: Number(selected.modularity.toFixed(4)),
      sizes,
      affinityMedian: Number((strengths[Math.floor(strengths.length / 2)] ?? 0).toFixed(3)),
      seedAgreement: Number(Math.min(agreement(runs[0]!.labels, runs[1]!.labels), agreement(runs[1]!.labels, runs[2]!.labels)).toFixed(3)),
    });
  }
}
console.log(JSON.stringify(results, null, 2));
