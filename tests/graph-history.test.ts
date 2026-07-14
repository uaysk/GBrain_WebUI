import { describe, expect, test } from "bun:test";
import { buildGraphTimeline, buildTimelineNode, type HistoryPageRow, type HistoryVersionRow } from "../server/graph-history";

const page: HistoryPageRow = {
  id: 7,
  created_at: "2025-01-01T08:00:00.000Z",
  current_content_hash: "current-c",
  current_content_length: 900,
};

describe("graph history reconstruction", () => {
  test("interprets snapshots as update boundaries and removes duplicate content states", () => {
    const versions: HistoryVersionRow[] = [
      { id: 1, page_id: 7, snapshot_at: "2025-01-02T09:00:00.000Z", content_hash: "old-a", content_length: 100 },
      { id: 2, page_id: 7, snapshot_at: "2025-01-03T09:00:00.000Z", content_hash: "old-b", content_length: 400 },
    ];
    const node = buildTimelineNode("source::page", page, versions);
    expect(node.static).toBe(false);
    expect(node.states.map((state) => state.at)).toEqual([
      "2025-01-01T08:00:00.000Z",
      "2025-01-02T09:00:00.000Z",
      "2025-01-03T09:00:00.000Z",
    ]);
    expect(node.states.map((state) => state.revision)).toEqual([0, 1, 2]);
    expect(node.states.at(-1)?.sizeScale).toBe(1);
    expect(node.states.every((state) => state.sizeScale >= 0.72 && state.sizeScale <= 1.18)).toBe(true);
  });

  test("keeps a node without page_versions present for the entire timeline", () => {
    expect(buildTimelineNode("source::static", page, [])).toEqual({
      id: "source::static",
      static: true,
      createdAt: "2025-01-01T08:00:00.000Z",
      states: [],
    });
  });

  test("collapses repeated snapshots without inventing transitions", () => {
    const node = buildTimelineNode("source::page", { ...page, current_content_hash: "new-b" }, [
      { id: 1, page_id: 7, snapshot_at: "2025-01-02T09:00:00.000Z", content_hash: "same-a", content_length: 100 },
      { id: 2, page_id: 7, snapshot_at: "2025-01-03T09:00:00.000Z", content_hash: "same-a", content_length: 100 },
    ]);
    expect(node.states.map((state) => state.at)).toEqual([
      "2025-01-01T08:00:00.000Z",
      "2025-01-03T09:00:00.000Z",
    ]);
  });

  test("reports versioned, static, state, and transition counts", () => {
    const timeline = buildGraphTimeline(
      "2025-01-05T00:00:00.000Z",
      new Map([[7, "source::versioned"], [8, "source::static"]]),
      [page, { ...page, id: 8 }],
      [{ id: 1, page_id: 7, snapshot_at: "2025-01-02T09:00:00.000Z", content_hash: "old-a", content_length: 100 }],
    );
    expect(timeline.versionedNodeCount).toBe(1);
    expect(timeline.staticNodeCount).toBe(1);
    expect(timeline.stateCount).toBe(2);
    expect(timeline.transitionCount).toBe(1);
    expect(timeline.startAt).toBe("2025-01-01T08:00:00.000Z");
    expect(timeline.endAt).toBe("2025-01-05T00:00:00.000Z");
  });
});
