import { describe, expect, test } from "bun:test";
import { detectLeidenCommunities, explicitCommunityWeight, semanticCommunityWeight } from "../server/community";

describe("Leiden community detection", () => {
  test("finds connected communities and leaves only relation-free nodes unclassified", () => {
    const nodes = ["a", "b", "c", "d", "e", "f", "isolated"];
    const semantic = [
      { source: "a", target: "b", similarity: 0.95 },
      { source: "b", target: "c", similarity: 0.94 },
      { source: "a", target: "c", similarity: 0.93 },
      { source: "d", target: "e", similarity: 0.96 },
      { source: "e", target: "f", similarity: 0.95 },
      { source: "d", target: "f", similarity: 0.94 },
      { source: "c", target: "d", similarity: 0.5 },
    ];
    const result = detectLeidenCommunities(nodes, semantic, [], { resolution: 1, minSemanticSimilarity: 0.65, seed: 7 });
    expect(result.communityCount).toBe(2);
    expect(result.labels.a).toBe(result.labels.b);
    expect(result.labels.d).toBe(result.labels.e);
    expect(result.labels.a).not.toBe(result.labels.d);
    expect(result.labels.isolated).toBe(-1);
    expect(result.isolatedCount).toBe(1);
    expect(result.strengths.isolated).toBeNull();
  });

  test("merges reciprocal semantic evidence into one weighted graph edge", () => {
    const result = detectLeidenCommunities(["a", "b"], [
      { source: "a", target: "b", similarity: 0.9 },
      { source: "b", target: "a", similarity: 0.92 },
    ], []);
    expect(result.weightedEdgeCount).toBe(1);
    expect(result.labels.a).toBe(result.labels.b);
  });

  test("uses deterministic random traversal and relation-family priorities", () => {
    const nodes = ["a", "b", "c", "d"];
    const explicit = [
      { source: "a", target: "b", family: "hierarchy" as const },
      { source: "c", target: "d", family: "mention" as const },
    ];
    const first = detectLeidenCommunities(nodes, [], explicit, { seed: 84 });
    const second = detectLeidenCommunities(nodes, [], explicit, { seed: 84 });
    expect(first.labels).toEqual(second.labels);
    expect(explicitCommunityWeight("hierarchy")).toBeGreaterThan(explicitCommunityWeight("mention"));
    expect(semanticCommunityWeight(0.64, 0.65)).toBe(0);
    expect(semanticCommunityWeight(0.9, 0.65)).toBeGreaterThan(0);
  });
});
