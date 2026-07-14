import { describe, expect, test } from "bun:test";
import { activeGraphEdges, bundleGraphEdges, connectedNodeIdsForGroup, neighborIdsForNode, relatedNodesForNode, type GraphLayerSettings } from "../src/graph/graph-layers";
import type { GraphEdge, GraphNode, GraphResponse } from "../src/types";

const edge = (id: string, kind: "explicit" | "semantic", source: string, target: string, similarity: number | null = null): GraphEdge => ({
  id, kind, source, target, similarity, linkType: kind, linkSource: null, family: kind === "semantic" ? "semantic" : "hierarchy",
  color: "#fff", dashPattern: [], width: 1, directed: kind === "explicit", curvature: 0, parallelIndex: 0, selfLink: false,
});

const graph = {
  explicitEdges: [edge("explicit", "explicit", "a", "b")],
  semanticEdges: [edge("semantic-high", "semantic", "a", "c", 0.9), edge("semantic-low", "semantic", "a", "d", 0.7)],
} as Pick<GraphResponse, "explicitEdges" | "semanticEdges">;

const layers = (patch: Partial<GraphLayerSettings> = {}): GraphLayerSettings => ({
  semanticOn: true, explicitOn: true, minSemanticSimilarity: 0.8, explicitFamilies: ["hierarchy"], ...patch,
});

describe("active graph layers", () => {
  test("excludes disabled and below-threshold edges from render and node focus", () => {
    const semanticOnly = activeGraphEdges(graph, layers({ explicitOn: false }));
    expect(semanticOnly.map((item) => item.id)).toEqual(["semantic-high"]);
    expect([...neighborIdsForNode("a", semanticOnly)].sort()).toEqual(["a", "c"]);

    const explicitOnly = activeGraphEdges(graph, layers({ semanticOn: false }));
    expect(explicitOnly.map((item) => item.id)).toEqual(["explicit"]);
    expect([...neighborIdsForNode("a", explicitOnly)].sort()).toEqual(["a", "b"]);
  });

  test("uses the same active edges for community hover and bundled relation counts", () => {
    const active = activeGraphEdges(graph, layers());
    expect([...connectedNodeIdsForGroup([{ id: "a", groupId: "one" }, { id: "b", groupId: "two" }, { id: "c", groupId: "two" }], active, "one")].sort()).toEqual(["a", "b", "c"]);
    expect(bundleGraphEdges([edge("one", "explicit", "a", "b"), edge("two", "semantic", "b", "a", 0.9)])[0]!.bundledEdges).toHaveLength(2);
  });

  test("groups active relations by related node and excludes the selected node itself", () => {
    const nodes = [
      { id: "a", title: "Selected" },
      { id: "b", title: "Explicit neighbor" },
      { id: "c", title: "Semantic neighbor" },
    ] as GraphNode[];
    const related = relatedNodesForNode("a", nodes, [
      edge("explicit-one", "explicit", "a", "b"),
      edge("explicit-two", "explicit", "b", "a"),
      edge("semantic", "semantic", "a", "c", 0.9),
      edge("self", "semantic", "a", "a", 1),
    ]);
    expect(related.map((item) => item.node.id)).toEqual(["b", "c"]);
    expect(related[0]!.edges.map((item) => item.id)).toEqual(["explicit-one", "explicit-two"]);
  });
});
