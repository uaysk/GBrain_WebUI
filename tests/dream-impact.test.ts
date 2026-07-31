import { describe, expect, test } from "bun:test";
import { affectedGraphNodes } from "../src/components/DreamImpactPanel";
import type { ControlDreamRunDetail, GraphNode } from "../src/types";

const nodes = [
  { id: "default::topics/one", sourceId: "default", slug: "topics/one", title: "One" },
  { id: "notes::둘", sourceId: "notes", slug: "둘", title: "둘" },
] as GraphNode[];

function detail(items: ControlDreamRunDetail["affectedPages"]["items"], total = items.length): ControlDreamRunDetail {
  return {
    snapshotGeneratedAt: "2026-07-31T00:00:00.000Z",
    stale: false,
    run: { id: 7 } as ControlDreamRunDetail["run"],
    previousRun: null,
    comparison: { metrics: [] },
    findings: [],
    affectedPages: { items, total, truncated: total > items.length, coverage: "complete" },
  };
}

describe("Dream impact projection", () => {
  test("highlights only exact source+slug identities present in the current graph", () => {
    const result = affectedGraphNodes({ nodes }, detail([
      { sourceId: "default", slug: "topics/one", phases: ["sync"] },
      { sourceId: "other", slug: "topics/one", phases: ["sync"] },
      { sourceId: "notes", slug: "둘", phases: ["patterns"] },
    ]));
    expect([...result.nodeIds]).toEqual(["default::topics/one", "notes::둘"]);
    expect(result.missingCount).toBe(1);
  });

  test("counts truncated or deleted refs as not shown without fabricating nodes", () => {
    const result = affectedGraphNodes({ nodes }, detail([
      { sourceId: "default", slug: "topics/one", phases: ["sync"] },
    ], 201));
    expect(result.nodes.map((node) => node.id)).toEqual(["default::topics/one"]);
    expect(result.missingCount).toBe(200);
  });
});
