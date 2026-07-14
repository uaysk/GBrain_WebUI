import type { GraphNode } from "../api/types";
import type { MapViewMode } from "./layout-2d";

interface Point3 { x: number; y: number; z: number }
export interface CameraPose { position: Point3; target: Point3 }

export function cameraPoseForNodes(
  nodes: Array<Pick<GraphNode, "x" | "y" | "z">>,
  viewMode: MapViewMode,
  currentPosition: Point3 = { x: 210, y: 155, z: 245 },
): CameraPose | null {
  if (!nodes.length) return null;
  const minimum = { x: Infinity, y: Infinity, z: Infinity };
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const node of nodes) {
    minimum.x = Math.min(minimum.x, Number(node.x)); maximum.x = Math.max(maximum.x, Number(node.x));
    minimum.y = Math.min(minimum.y, Number(node.y)); maximum.y = Math.max(maximum.y, Number(node.y));
    minimum.z = Math.min(minimum.z, Number(node.z)); maximum.z = Math.max(maximum.z, Number(node.z));
  }
  const target = {
    x: (minimum.x + maximum.x) / 2,
    y: (minimum.y + maximum.y) / 2,
    z: (minimum.z + maximum.z) / 2,
  };
  const radius = Math.max(12, Math.hypot(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z) / 2);
  if (viewMode === "2d") return { position: { x: target.x, y: target.y, z: target.z + Math.max(78, radius * 2.75) }, target };
  const directionLength = Math.hypot(currentPosition.x - target.x, currentPosition.y - target.y, currentPosition.z - target.z) || 1;
  const distance = Math.max(78, radius * 2.9);
  return {
    position: {
      x: target.x + (currentPosition.x - target.x) / directionLength * distance,
      y: target.y + (currentPosition.y - target.y) / directionLength * distance,
      z: target.z + (currentPosition.z - target.z) / directionLength * distance,
    },
    target,
  };
}
