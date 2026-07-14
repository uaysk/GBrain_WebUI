import { describe, expect, test } from "bun:test";
import { placeUnclassifiedNearGraph, relaxNodeCollisions, separateSemanticGroups } from "../server/layout";
import { createMap2DLayout, easeInOutCubic } from "../src/graph/layout-2d";
import type { GraphNode } from "../src/types";

describe("semantic layout spacing", () => {
  test("separates overlapping group volumes deterministically", () => {
    const coords = [[0, 0, 0], [2, 0, 0], [1, 1, 0], [3, 1, 0], [2, 2, 0], [4, 2, 0]];
    const groups = [0, 0, 1, 1, 2, 2];
    const first = separateSemanticGroups(coords, groups, 12);
    const second = separateSemanticGroups(coords, groups, 12);
    expect(first).toEqual(second);
    const centers = [0, 1, 2].map((group) => {
      const members = first.filter((_, index) => groups[index] === group);
      return [0, 1, 2].map((axis) => members.reduce((sum, point) => sum + point[axis]!, 0) / members.length);
    });
    expect(Math.min(
      Math.hypot(...centers[0]!.map((value, axis) => value - centers[1]![axis]!)),
      Math.hypot(...centers[1]!.map((value, axis) => value - centers[2]![axis]!)),
    )).toBeGreaterThan(20);
  });

  test("enforces a useful minimum node distance", () => {
    const relaxed = relaxNodeCollisions([[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0]], 4, 24);
    for (let left = 0; left < relaxed.length; left += 1) for (let right = left + 1; right < relaxed.length; right += 1) {
      expect(Math.hypot(...relaxed[left]!.map((value, axis) => value - relaxed[right]![axis]!))).toBeGreaterThan(3.8);
    }
  });

  test("uses the sum of visual radii plus a gap", () => {
    const relaxed = relaxNodeCollisions([[0, 0, 0], [0.1, 0, 0]], [2.4, 1.8], 32, 0.8);
    expect(Math.hypot(...relaxed[0]!.map((value, axis) => value - relaxed[1]![axis]!))).toBeGreaterThan(4.95);
  });

  test("places unclassified nodes on a deterministic near-graph ring", () => {
    const coords = [[4, 5, 6], [150, 0, 0], [0, 150, 0], [-150, 0, 0], [0, -150, 0]];
    const flags = [false, true, true, true, true];
    const first = placeUnclassifiedNearGraph(coords, flags);
    const second = placeUnclassifiedNearGraph(coords, flags);
    expect(first).toEqual(second);
    expect(first[0]).toEqual(coords[0]);
    for (const point of first.slice(1)) {
      const distance = Math.hypot(...point);
      expect(distance).toBeGreaterThan(67);
      expect(distance).toBeLessThan(77);
    }
  });
});

describe("dedicated 2D map layout", () => {
  const node = (id: string, groupId: string, x: number, y: number, z: number, options: Partial<GraphNode> = {}): GraphNode => ({
    id, dbId: 1, sourceId: "default", sourceName: "Default", slug: id, title: id, type: "concept", shape: "circle",
    groupId, groupLabel: groupId, color: "#ffffff", chunkCount: 1, degree: 1, size: 1.4,
    hasEmbedding: true, isUnclassified: false, communityStrength: 1, x, y, z, ...options,
  });

  test("creates a deterministic flat layout without node or community overlap", () => {
    const nodes = [
      node("a", "one", 0, 0, 0), node("b", "one", 0, 0, 0), node("c", "one", 0.2, 0, 3),
      node("d", "two", 0, 0, 8), node("e", "two", 0.1, 0, 8),
      node("f", "three", 1, 0, 16), node("g", "three", 1.1, 0, 16),
      node("loose", "unclassified", 0, 0, 0, { isUnclassified: true }),
      node("outline", "one", 0, 0, 0, { hasEmbedding: false }),
    ];
    const first = createMap2DLayout(nodes);
    const second = createMap2DLayout(nodes);
    expect(first).toEqual(second);
    expect(Object.values(first.positions).every((point) => point.z === 0)).toBe(true);
    expect(first.minimumNodeGap).toBeGreaterThan(0.75);
    expect(first.minimumCommunityGap).toBeGreaterThan(13.8);
    expect(first.looseNodeIds.sort()).toEqual(["loose", "outline"]);
    const outerRadius = Math.hypot(first.positions.loose!.x, first.positions.loose!.y);
    expect(outerRadius).toBeGreaterThan(Math.max(...first.communityDiscs.map((disc) => Math.hypot(disc.center.x, disc.center.y) + disc.radius)));
  });

  test("uses a smooth symmetric morph easing curve", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 10);
  });
});
