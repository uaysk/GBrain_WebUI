import { describe, expect, test } from "bun:test";
import { assignCurvatures, familyForType, RELATION_STYLE, shapeForType } from "../server/style";
import { RELATION_DIRECTION_ARROW_LENGTH } from "../src/graph/visual-spec";

describe("node shape mapping", () => {
  test("maps every required page type", () => {
    expect(shapeForType("concept")).toBe("circle");
    expect(shapeForType("project")).toBe("square");
    expect(shapeForType("project_note")).toBe("square");
    expect(shapeForType("analysis")).toBe("diamond");
    expect(shapeForType("incident-followup")).toBe("triangle");
    expect(shapeForType("ops-snapshot")).toBe("hexagon");
    expect(shapeForType("extract_receipt")).toBe("octagon");
    expect(shapeForType("unexpected")).toBe("pentagon");
  });
});

describe("relation style mapping", () => {
  test("classifies known GBrain link types", () => {
    expect(familyForType("mentions")).toBe("mention");
    expect(familyForType("related_to")).toBe("association");
    expect(familyForType("part_of")).toBe("hierarchy");
    expect(familyForType("derived_from")).toBe("provenance");
    expect(familyForType("superseded_by")).toBe("temporal");
    expect(familyForType("depends_on")).toBe("hierarchy");
    expect(familyForType("bespoke_relation")).toBe("association");
  });

  test("keeps every relation straight without arrows or curvature", () => {
    const edges = assignCurvatures([
      { id: "a", source: "one", target: "two", family: "mention" as const },
      { id: "b", source: "two", target: "one", family: "hierarchy" as const },
      { id: "c", source: "one", target: "one", family: "custom" as const },
    ]);
    expect(edges.every((edge) => edge.curvature === 0)).toBe(true);
    expect(RELATION_DIRECTION_ARROW_LENGTH).toBe(0);
    expect(edges[2]!.selfLink).toBe(true);
    expect(RELATION_STYLE.semantic.width).toBe(0.6);
    expect(RELATION_STYLE.temporal.width).toBe(3);
    expect(RELATION_STYLE.hierarchy.dash).toEqual([]);
    expect(RELATION_STYLE.temporal.dash).toEqual([9, 5]);
  });
});
