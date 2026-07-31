import type { GraphEdge, GraphNode, GraphResponse, GraphTimelineResponse } from "../shared/contracts";
import { GraphTimelineIndex, type GraphTimelineFrame } from "../src/graph/graph-timeline";
import { GraphViewIndex } from "../src/graph/graph-view-index";
import { createMap2DLayout, detailed2DPairWork } from "../src/graph/layout-2d";
import { relaxNodeCollisions } from "../server/layout";

function node(index: number, groups: number): GraphNode {
  return {
    id: `node-${index.toString().padStart(5, "0")}`,
    dbId: index + 1,
    sourceId: "default",
    sourceName: "Default",
    slug: `node-${index}`,
    title: `Node ${index}`,
    type: "note",
    shape: "diamond",
    groupId: `group-${index % groups}`,
    groupLabel: `Group ${index % groups}`,
    color: "#4cc9d9",
    chunkCount: 2,
    degree: 4,
    size: 1 + (index % 5) * 0.05,
    hasEmbedding: true,
    isUnclassified: false,
    communityStrength: 0.8,
    x: (index % 100) * 2.5,
    y: Math.floor(index / 100) % 100 * 2.5,
    z: Math.floor(index / 10_000) * 2.5,
  };
}

function edge(index: number, count: number, kind: "explicit" | "semantic"): GraphEdge {
  return {
    id: `${kind}-${index}`,
    source: `node-${index.toString().padStart(5, "0")}`,
    target: `node-${((index + (kind === "explicit" ? 1 : 97)) % count).toString().padStart(5, "0")}`,
    kind,
    linkType: kind === "explicit" ? "related" : "semantic_similarity",
    linkSource: null,
    family: kind === "explicit" ? "association" : "semantic",
    color: "#4cc9d9",
    dashPattern: [],
    width: 1,
    directed: false,
    similarity: kind === "semantic" ? 0.8 : null,
    curvature: 0,
    parallelIndex: 0,
    selfLink: false,
  };
}

function graph(count: number): GraphResponse {
  const nodes = Array.from({ length: count }, (_, index) => node(index, 50));
  const explicitEdges = Array.from({ length: count }, (_, index) => edge(index, count, "explicit"));
  const semanticEdges = Array.from({ length: count }, (_, index) => edge(index, count, "semantic"));
  return {
    generatedAt: "2026-07-31T00:00:00.000Z",
    nodes,
    explicitEdges,
    semanticEdges,
    semanticGroups: Array.from({ length: 50 }, (_, index) => ({ id: `group-${index}`, label: `Group ${index}`, color: "#4cc9d9", count: count / 50, kind: "community" })),
    communityDetection: { engine: "leiden", resolution: 0.5, modularity: 0.4, communityCount: 50, weightedEdgeCount: count * 2, isolatedCount: 0, minSemanticSimilarity: 0.65 },
    counts: { pages: count, chunks: count * 2, links: count, explicitEdges: count, semanticEdges: count, embeddedPages: count, unembeddedPages: 0, unclassifiedPages: 0, embeddingCoverage: 1 },
    layout: { engine: "packed-grid", scalableThreshold: 2_000 },
  };
}

function timeline(count: number): GraphTimelineResponse {
  return {
    graphGeneratedAt: "2026-07-31T00:00:00.000Z",
    startAt: "2026-07-01T00:00:00.000Z",
    endAt: "2026-07-31T00:00:00.000Z",
    versionedNodeCount: count,
    staticNodeCount: 0,
    stateCount: count * 2,
    transitionCount: count,
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `node-${index.toString().padStart(5, "0")}`,
      static: false,
      createdAt: "2026-07-01T00:00:00.000Z",
      states: [
        { at: "2026-07-01T00:00:00.000Z", revision: 0, sizeScale: 0.9 },
        { at: "2026-07-20T00:00:00.000Z", revision: 1, sizeScale: 1 },
      ],
    })),
  };
}

function measure(task: () => void, runs = 8): number[] {
  task();
  return Array.from({ length: runs }, () => {
    const started = performance.now();
    task();
    return performance.now() - started;
  });
}

function p95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function legacyRelax(coords: number[][], radius: number, iterations: number): void {
  const points = coords.map((point) => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const delta = points[right]!.map((value, axis) => value - (points[left]?.[axis] ?? 0));
        const distance = Math.hypot(...delta);
        if (distance >= radius) continue;
        const angle = ((left + 1) * 2.399963 + (right + 1) * 1.618034) % (Math.PI * 2);
        const direction = distance < 1e-6
          ? [Math.cos(angle), Math.sin(angle), 0]
          : delta.map((value) => value / distance);
        const force = (radius - distance) * 0.3;
        direction.forEach((value, axis) => {
          points[left]![axis] = (points[left]?.[axis] ?? 0) - value * force;
          points[right]![axis] = (points[right]?.[axis] ?? 0) + value * force;
        });
      }
    }
  }
}

const detailedNodes = Array.from({ length: 191 }, (_, index) => node(index, 8));
if (detailed2DPairWork(detailedNodes) > 2_500_000) throw new Error("Representative 2D graph unexpectedly selected packed mode");
const layoutP95 = p95(measure(() => { createMap2DLayout(detailedNodes); }, 6));

const largeGraph = graph(10_000);
const indexP95 = p95(measure(() => { new GraphViewIndex(largeGraph); }, 8));
const timelineIndex = new GraphTimelineIndex(timeline(10_000));
const frame: GraphTimelineFrame = {
  at: "2026-07-25T00:00:00.000Z",
  day: "2026-07-25",
  changedNodeIds: new Set(),
  createdNodeIds: new Set(),
  updatedNodeIds: new Set(),
  current: false,
};
const timelineP95 = p95(measure(() => { timelineIndex.project(largeGraph, frame); }, 8));

const collisionInput = Array.from({ length: 2_000 }, (_, index) => [
  (index % 50) * 1.4,
  (Math.floor(index / 50) % 40) * 1.4,
  (index % 3) * 0.1,
]);
const spatialTimes = measure(() => { relaxNodeCollisions(collisionInput, 1.8, 4); }, 3);
const legacyTimes = measure(() => { legacyRelax(collisionInput, 1.8, 4); }, 2);
const collisionSpeedup = p95(legacyTimes) / p95(spatialTimes);
const first = relaxNodeCollisions(collisionInput, 1.8, 4);
const second = relaxNodeCollisions(collisionInput, 1.8, 4);
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Spatial collision relaxation is not deterministic");

const result = {
  detailed2DLayoutP95Ms: Number(layoutP95.toFixed(2)),
  graphViewIndex10kP95Ms: Number(indexP95.toFixed(2)),
  timelineProjection10kP95Ms: Number(timelineP95.toFixed(2)),
  collision2kSpeedup: Number(collisionSpeedup.toFixed(2)),
};
console.log(JSON.stringify(result, null, 2));

if (layoutP95 > 100) throw new Error(`Detailed 2D p95 exceeded 100ms: ${layoutP95.toFixed(2)}ms`);
if (indexP95 > 40) throw new Error(`GraphViewIndex 10k p95 exceeded 40ms: ${indexP95.toFixed(2)}ms`);
if (timelineP95 > 20) throw new Error(`Timeline 10k p95 exceeded 20ms: ${timelineP95.toFixed(2)}ms`);
if (collisionSpeedup < 5) throw new Error(`Collision speedup was below 5x: ${collisionSpeedup.toFixed(2)}x`);
