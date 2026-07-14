import { describe, expect, test } from "bun:test";
import { cameraPoseForNodes } from "../src/graph/camera";
import { configureNavigationControls } from "../src/graph/navigation-controls";
import { isSelectionClearKey } from "../src/graph/selection";
import { MOUSE } from "three";

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

describe("map navigation controls", () => {
  test("maps left drag to pan in 2D and restores rotation in 3D", () => {
    const controls = {
      noRotate: false,
      noPan: true,
      enableRotate: true,
      enablePan: false,
      staticMoving: false,
      panSpeed: 0.3,
      mouseButtons: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
      updates: 0,
      update() { this.updates += 1; },
    };

    configureNavigationControls(controls, "2d");
    expect(controls.noRotate).toBe(true);
    expect(controls.noPan).toBe(false);
    expect(controls.enableRotate).toBe(false);
    expect(controls.enablePan).toBe(true);
    expect(controls.staticMoving).toBe(true);
    expect(controls.panSpeed).toBe(0.2);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.PAN);

    configureNavigationControls(controls, "3d");
    expect(controls.noRotate).toBe(false);
    expect(controls.enableRotate).toBe(true);
    expect(controls.staticMoving).toBe(false);
    expect(controls.panSpeed).toBe(0.3);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(controls.updates).toBe(2);
  });
});
