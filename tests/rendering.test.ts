import { describe, expect, test } from "bun:test";
import { billboardVertices } from "../src/graph/node-billboard";
import { COMMUNITY_LABEL_STYLE, communityLabelTitle, connectedNodeIdsForGroup, pixelAlignedLabelOrigin } from "../src/graph/community-label";
import { edgeSegmentPositions } from "../src/graph/rendering";
import { haloTransformForNodes, nodesInCommunityHalo } from "../src/graph/halo";
import { NODE_RADIUS_SCALE, UNCLASSIFIED_NODE_COLOR, type GraphEdge, type NodeShape } from "../src/types";

describe("billboard node shapes", () => {
  test("defines the expected normalized 2D polygon for every non-circular glyph", () => {
    const expectedSides: Record<NodeShape, number> = {
      circle: 0, triangle: 3, square: 4, diamond: 4, pentagon: 5, hexagon: 6, octagon: 8,
    };
    for (const [shape, sides] of Object.entries(expectedSides) as Array<[NodeShape, number]>) {
      const vertices = billboardVertices(shape);
      expect(vertices.length).toBe(sides);
      expect(vertices.every(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-10)).toBe(true);
    }
  });

  test("uses exactly half of the previous billboard radius", () => {
    expect(NODE_RADIUS_SCALE).toBe(0.675);
    expect(NODE_RADIUS_SCALE).toBe(1.35 / 2);
  });
});

describe("community labels", () => {
  test("uses pixel-aligned placement and reveals translucent text on halo hover", () => {
    expect(communityLabelTitle("Leiden 04 · concept")).toBe("concept");
    expect(communityLabelTitle("No retained relation")).toBe("No retained relation");
    expect(pixelAlignedLabelOrigin({ x: 100.49, y: 80.51 }, { width: 41, height: 17 })).toEqual({ left: 80, top: 64 });
    expect(COMMUNITY_LABEL_STYLE.color).toBe("rgba(255,255,255,0.30)");
    expect(COMMUNITY_LABEL_STYLE.hoverColor).toBe("rgba(255,255,255,1)");
    expect(COMMUNITY_LABEL_STYLE.dimColor).toBe("rgba(255,255,255,0.09)");
    expect(COMMUNITY_LABEL_STYLE.backgroundColor).toBe("rgba(0,0,0,0.40)");
    expect(UNCLASSIFIED_NODE_COLOR).toBe("#E8A838");
  });

  test("focuses a hovered community and every directly connected node", () => {
    const focused = connectedNodeIdsForGroup(
      [{ id: "a", groupId: "one" }, { id: "b", groupId: "one" }, { id: "c", groupId: "two" }, { id: "d", groupId: "three" }],
      [{ source: "a", target: "c" }, { source: { id: "d" }, target: { id: "c" } }],
      "one",
    );
    expect([...focused].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("community halo geometry", () => {
  test("uses only embedded nodes in the selected community as halo members", () => {
    const nodes = [
      { id: "included", groupId: "group-1", hasEmbedding: true },
      { id: "outline-only", groupId: "group-1", hasEmbedding: false },
      { id: "other", groupId: "group-2", hasEmbedding: true },
    ];

    expect(nodesInCommunityHalo(nodes, "group-1").map((node) => node.id)).toEqual(["included"]);
  });

  test("tracks member bounds and flattens only the depth radius in 2D", () => {
    const members = [{ x: -4, y: -2, z: -6 }, { x: 8, y: 6, z: 10 }];
    const spatial = haloTransformForNodes(members, 0)!;
    const flat = haloTransformForNodes(members, 1)!;
    expect(spatial.center).toEqual([2, 2, 2]);
    expect(flat.center).toEqual(spatial.center);
    expect(flat.radii[0]).toBe(spatial.radii[0]);
    expect(flat.radii[1]).toBe(spatial.radii[1]);
    expect(flat.radii[2]).toBe(1.35);
  });
});

describe("morph edge segments", () => {
  test("generates solid and dashed straight segments without sampled Vector3 allocations", () => {
    const solid = edgeSegmentPositions(
      { selfLink: false, dashPattern: [] } as unknown as GraphEdge,
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    );
    expect([...solid]).toEqual([0, 0, 0, 5, 0, 0]);

    const dashed = edgeSegmentPositions(
      { selfLink: false, dashPattern: [2, 1] } as unknown as GraphEdge,
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    );
    expect([...dashed]).toEqual([0, 0, 0, 2, 0, 0, 3, 0, 0, 5, 0, 0]);
  });
});
