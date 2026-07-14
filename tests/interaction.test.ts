import { describe, expect, test } from "bun:test";
import { cameraPoseForNodes } from "../src/graph/camera";
import { isSelectionClearKey } from "../src/graph/selection";

describe("focus mode helpers", () => {
  test("frames the selected neighborhood in both dimensions", () => {
    const nodes = [{ x: -10, y: -5, z: -3 }, { x: 10, y: 5, z: 3 }];
    const flat = cameraPoseForNodes(nodes, "2d")!;
    const spatial = cameraPoseForNodes(nodes, "3d")!;
    expect(flat.target).toEqual({ x: 0, y: 0, z: 0 });
    expect(flat.position.x).toBe(0);
    expect(flat.position.y).toBe(0);
    expect(flat.position.z).toBeGreaterThan(70);
    expect(Math.hypot(spatial.position.x, spatial.position.y, spatial.position.z)).toBeGreaterThan(70);
  });

  test("clears selection only for Escape", () => {
    expect(isSelectionClearKey("Escape")).toBe(true);
    expect(isSelectionClearKey("Enter")).toBe(false);
  });
});
