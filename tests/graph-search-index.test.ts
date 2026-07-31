import { describe, expect, test } from "bun:test";
import type { GraphNode, GraphResponse } from "../src/api/types";
import {
  GRAPH_SEARCH_RECENT_LIMIT,
  GRAPH_SEARCH_RESULT_LIMIT,
  GraphSearchIndex,
  getGraphSearchIndex,
  normalizeGraphSearchText,
} from "../src/graph/graph-search-index";

function node(id: string, dbId: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    dbId,
    sourceId: "default",
    sourceName: "Default Source",
    slug: `notes/${id}`,
    title: id,
    type: "note",
    shape: "circle",
    groupId: "community-ops",
    groupLabel: "Operations",
    color: "#22d3ee",
    chunkCount: 1,
    degree: 0,
    size: 1,
    hasEmbedding: true,
    isUnclassified: false,
    communityStrength: 1,
    x: 0,
    y: 0,
    z: 0,
    ...overrides,
  };
}

function graph(nodes: GraphNode[]): GraphResponse {
  return {
    generatedAt: "2026-07-31T00:00:00.000Z",
    nodes,
    explicitEdges: [],
    semanticEdges: [],
    semanticGroups: [
      { id: "community-ops", label: "Operations", color: "#22d3ee", count: nodes.length, kind: "community" },
      { id: "community-ai", label: "AI 연구", color: "#a78bfa", count: 1, kind: "community" },
    ],
    communityDetection: {
      engine: "leiden",
      resolution: 1,
      modularity: 0.4,
      communityCount: 2,
      weightedEdgeCount: 0,
      isolatedCount: 0,
      minSemanticSimilarity: 0.65,
    },
    counts: {
      pages: nodes.length,
      chunks: nodes.length,
      links: 0,
      explicitEdges: 0,
      semanticEdges: 0,
      embeddedPages: nodes.length,
      unembeddedPages: 0,
      unclassifiedPages: 0,
      embeddingCoverage: nodes.length ? 1 : 0,
    },
    layout: { engine: "umap", scalableThreshold: 2_000 },
  };
}

describe("GraphSearchIndex", () => {
  test("normalizes Korean, English casing, and compatibility-width text", () => {
    const index = new GraphSearchIndex(graph([
      node("memory", 1, { title: "기억 지도", slug: "topics/memory-map", sourceName: "운영 메모", groupLabel: "인프라" }),
      node("ai", 2, { title: "ＡＩ Operations", sourceName: "Research", groupId: "community-ai", groupLabel: "AI 연구" }),
    ]));

    expect(normalizeGraphSearchText("  ＡＩ\u3000Operations  ")).toBe("ai operations");
    expect(index.search("기억")[0]).toMatchObject({ kind: "node", id: "memory" });
    expect(index.search("MEMORY-MAP")[0]).toMatchObject({ kind: "node", id: "memory" });
    expect(index.search("ai operations")[0]).toMatchObject({ kind: "node", id: "ai", match: "exact" });
    expect(index.search("인프라")[0]).toMatchObject({ kind: "node", id: "memory" });
  });

  test("ranks exact, prefix, all-token, then substring matches", () => {
    const index = new GraphSearchIndex(graph([
      node("substring", 1, { title: "Deepmemoryarchive" }),
      node("tokens", 2, { title: "A memory archive" }),
      node("prefix", 3, { title: "Memory Lane" }),
      node("exact", 4, { title: "Memory" }),
    ]));

    expect(index.search("memory").filter((result) => result.kind === "node").map((result) => [result.id, result.match])).toEqual([
      ["exact", "exact"],
      ["prefix", "prefix"],
      ["tokens", "all-token"],
      ["substring", "substring"],
    ]);
  });

  test("matches all query tokens across title, source, type, and community metadata", () => {
    const index = new GraphSearchIndex(graph([
      node("runbook", 1, { title: "Cluster Runbook", sourceName: "홈랩 Notes", type: "project", groupLabel: "Kubernetes 운영" }),
    ]));

    expect(index.search("cluster 홈랩 project kubernetes")[0]).toMatchObject({
      kind: "node",
      id: "runbook",
      match: "all-token",
    });
    expect(index.search("AI 연구")[0]).toMatchObject({ kind: "community", id: "community-ai", match: "exact" });
  });

  test("uses deterministic tie breaks independent of snapshot node order", () => {
    const nodes = [
      node("z", 1, { title: "Memory Alpha" }),
      node("a", 2, { title: "Memory Alpha" }),
      node("b", 3, { title: "Memory Beta" }),
    ];
    const forward = new GraphSearchIndex(graph(nodes)).search("memory").map((result) => result.key);
    const reversed = new GraphSearchIndex(graph([...nodes].reverse())).search("memory").map((result) => result.key);

    expect(forward).toEqual(reversed);
    expect(forward.slice(0, 3)).toEqual(["node:a", "node:z", "node:b"]);
  });

  test("returns the newest eight nodes for an empty query and caps every result set at twenty", () => {
    const nodes = Array.from({ length: 25 }, (_, index) => node(`node-${index + 1}`, index + 1, {
      title: `Common ${String(index + 1).padStart(2, "0")}`,
    }));
    const index = new GraphSearchIndex(graph(nodes));

    expect(index.search("   ")).toHaveLength(GRAPH_SEARCH_RECENT_LIMIT);
    expect(index.search("").map((result) => result.id)).toEqual(["node-25", "node-24", "node-23", "node-22", "node-21", "node-20", "node-19", "node-18"]);
    expect(index.search("common", 100)).toHaveLength(GRAPH_SEARCH_RESULT_LIMIT);
  });

  test("reuses one pre-normalized index per snapshot object", () => {
    const snapshot = graph([node("one", 1)]);
    expect(getGraphSearchIndex(snapshot)).toBe(getGraphSearchIndex(snapshot));
    expect(getGraphSearchIndex({ ...snapshot })).not.toBe(getGraphSearchIndex(snapshot));
  });
});
