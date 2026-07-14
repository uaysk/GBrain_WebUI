import { describe, expect, test } from "bun:test";
import type { GraphNode, GraphResponse, GraphTimelineResponse } from "../src/api/types";
import { createGraphTimelineFrames, projectGraphAtFrame, timelineStateAt } from "../src/graph/graph-timeline";

function node(id: string, groupId: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id, dbId: id.charCodeAt(0), sourceId: "source", sourceName: "Source", slug: id, title: id.toUpperCase(), type: "note",
    shape: "circle", groupId, groupLabel: groupId, color: "#22d3ee", chunkCount: 2, degree: 1, size: 2,
    hasEmbedding: true, isUnclassified: false, communityStrength: 1, x: 0, y: 0, z: 0, ...overrides,
  };
}

const graph: GraphResponse = {
  generatedAt: "2025-01-04T12:00:00.000Z",
  nodes: [node("a", "group-1"), node("b", "group-1"), node("c", "unclassified", { hasEmbedding: false, isUnclassified: true })],
  explicitEdges: [{ id: "ab", source: "a", target: "b", kind: "explicit", linkType: "link", linkSource: null, family: "association", color: "#fff", dashPattern: [], width: 1, directed: false, similarity: null, curvature: 0, parallelIndex: 0, selfLink: false }],
  semanticEdges: [{ id: "bc", source: "b", target: "c", kind: "semantic", linkType: "similar", linkSource: null, family: "semantic", color: "#0ff", dashPattern: [], width: 1, directed: false, similarity: 0.8, curvature: 0, parallelIndex: 0, selfLink: false }],
  semanticGroups: [
    { id: "group-1", label: "One", color: "#0ff", count: 2, kind: "community" },
    { id: "unclassified", label: "None", color: "#777", count: 1, kind: "unclassified" },
  ],
  communityDetection: { engine: "leiden", resolution: 1, modularity: 0.4, communityCount: 1, weightedEdgeCount: 2, isolatedCount: 1, minSemanticSimilarity: 0.65 },
  counts: { pages: 3, chunks: 6, links: 1, explicitEdges: 1, semanticEdges: 1, embeddedPages: 2, unembeddedPages: 1, unclassifiedPages: 1, embeddingCoverage: 2 / 3 },
};

const timeline: GraphTimelineResponse = {
  graphGeneratedAt: graph.generatedAt,
  startAt: "2025-01-01T08:00:00.000Z",
  endAt: graph.generatedAt,
  versionedNodeCount: 2,
  staticNodeCount: 1,
  stateCount: 4,
  transitionCount: 2,
  nodes: [
    { id: "a", static: false, createdAt: "2025-01-01T08:00:00.000Z", states: [
      { at: "2025-01-01T08:00:00.000Z", revision: 0, sizeScale: 0.75 },
      { at: "2025-01-03T09:00:00.000Z", revision: 1, sizeScale: 1 },
    ] },
    { id: "b", static: false, createdAt: "2025-01-02T08:00:00.000Z", states: [
      { at: "2025-01-02T08:00:00.000Z", revision: 0, sizeScale: 0.8 },
      { at: "2025-01-03T10:00:00.000Z", revision: 1, sizeScale: 1 },
    ] },
    { id: "c", static: true, createdAt: "2025-01-03T08:00:00.000Z", states: [] },
  ],
};

describe("graph timeline projection", () => {
  test("groups changes by day and always includes a current frame", () => {
    const frames = createGraphTimelineFrames(timeline);
    expect(frames.map((frame) => frame.day)).toEqual(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"]);
    expect([...frames[2]!.changedNodeIds].sort()).toEqual(["a", "b"]);
    expect(frames.at(-1)?.current).toBe(true);
  });

  test("keeps unversioned nodes visible while versioned nodes appear at their first state", () => {
    const frames = createGraphTimelineFrames(timeline);
    const first = projectGraphAtFrame(graph, timeline, frames[0]!);
    expect(first.graph.nodes.map((item) => item.id).sort()).toEqual(["a", "c"]);
    expect(first.visibleNodeIds.has("c")).toBe(true);
    expect(first.graph.nodes.find((item) => item.id === "a")?.size).toBe(1.5);
    expect(first.graph.explicitEdges).toHaveLength(0);
    expect(first.graph.semanticEdges).toHaveLength(0);
    expect(first.graph.semanticGroups.find((group) => group.id === "unclassified")?.count).toBe(1);
  });

  test("filters current relationships to visible endpoints", () => {
    const frames = createGraphTimelineFrames(timeline);
    const second = projectGraphAtFrame(graph, timeline, frames[1]!);
    expect(second.graph.nodes).toHaveLength(3);
    expect(second.graph.explicitEdges.map((edge) => edge.id)).toEqual(["ab"]);
    expect(second.graph.semanticEdges.map((edge) => edge.id)).toEqual(["bc"]);
    expect(second.graph.counts.pages).toBe(3);
    expect(second.graph.counts.chunks).toBe(6);
  });

  test("chooses the latest known state at a frame boundary", () => {
    const versioned = timeline.nodes[0]!;
    expect(timelineStateAt(versioned, "2024-12-31T00:00:00.000Z")).toBeNull();
    expect(timelineStateAt(versioned, "2025-01-02T00:00:00.000Z")?.revision).toBe(0);
    expect(timelineStateAt(versioned, "2025-01-03T09:00:00.000Z")?.revision).toBe(1);
  });
});
