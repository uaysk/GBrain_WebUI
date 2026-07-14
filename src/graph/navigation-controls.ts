import { MOUSE } from "three";
import type { MapViewMode } from "./layout-2d";

interface NavigationControls {
  noRotate?: boolean;
  noPan?: boolean;
  enableRotate?: boolean;
  enablePan?: boolean;
  staticMoving?: boolean;
  panSpeed?: number;
  mouseButtons?: { LEFT: number; MIDDLE?: number; RIGHT?: number };
  update?: () => void;
}

export function configureNavigationControls(controls: NavigationControls | null | undefined, viewMode: MapViewMode) {
  if (!controls) return;
  const flat = viewMode === "2d";
  controls.noRotate = flat;
  controls.noPan = false;
  if ("enableRotate" in controls) controls.enableRotate = !flat;
  if ("enablePan" in controls) controls.enablePan = true;
  controls.staticMoving = flat;
  controls.panSpeed = flat ? 0.2 : 0.3;
  if (controls.mouseButtons) controls.mouseButtons.LEFT = flat ? MOUSE.PAN : MOUSE.ROTATE;
  controls.update?.();
}
