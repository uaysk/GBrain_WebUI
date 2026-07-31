import * as THREE from "three";
import SpriteText from "three-spritetext";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { NODE_RADIUS_SCALE, NODE_SELECTED_SCALE, type GraphEdge, type GraphNode } from "../types";
import { BillboardTexturePool, createNodeBillboard, type BillboardState } from "./node-billboard";

export type NodeRenderState = BillboardState & { showLabel: boolean };

export function createNodeObject(node: GraphNode, state: NodeRenderState, pool: BillboardTexturePool) {
  const group = new THREE.Group();
  const size = NODE_RADIUS_SCALE * node.size * (state.selected ? NODE_SELECTED_SCALE : 1);
  const billboard = createNodeBillboard(node, state, size * 2, pool);
  billboard.userData.baseOpacity = billboard.material.opacity;
  group.name = "memory-node-object";
  group.userData.nodeId = node.id;
  group.add(billboard);
  if (state.showLabel) {
    const label = new SpriteText(node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title);
    label.color = state.dimmed ? "#777777" : "#e8e8e8";
    label.textHeight = 2.6;
    label.backgroundColor = "rgba(10,10,10,0.78)";
    label.padding = 1.2;
    label.borderRadius = 2;
    label.position.set(0, size + 3.4, 0);
    label.material.depthWrite = false;
    group.add(label);
  }
  return group;
}

export function updateNodeObject(
  object: THREE.Object3D,
  node: GraphNode,
  state: NodeRenderState,
  pool: BillboardTexturePool,
): void {
  const sprite = object.children.find((child): child is THREE.Sprite => child instanceof THREE.Sprite && child.name === "node-billboard");
  if (!sprite) return;
  const size = NODE_RADIUS_SCALE * node.size * (state.selected ? NODE_SELECTED_SCALE : 1);
  const signature = pool.signature(node, state);
  if (sprite.userData.textureSignature !== signature) {
    const previous = sprite.material.map;
    sprite.material.map = pool.acquire(node, state);
    sprite.material.needsUpdate = true;
    sprite.userData.textureSignature = signature;
    pool.release(previous);
  }
  sprite.scale.set(size * 2, size * 2, 1);
  sprite.material.opacity = state.dimmed ? 0.13 : 0.96;
  sprite.userData.baseOpacity = sprite.material.opacity;
}

export function disposeNodeObject(object: THREE.Object3D, pool: BillboardTexturePool): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Sprite)) return;
    pool.release(child.material.map);
    child.material.dispose();
  });
}

interface Point { x: number; y: number; z: number }

export function edgeSegmentPositions(edge: GraphEdge, start: Point, end: Point): Float32Array {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dy, dz);
  if (edge.selfLink || length < 1e-8) return new Float32Array();
  if (!edge.dashPattern.length) return new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]);
  const output: number[] = [];
  let patternIndex = 0;
  let remaining = edge.dashPattern[0]!;
  let drawing = true;
  let consumed = 0;
  while (consumed < length - 1e-8) {
    const step = Math.min(remaining, length - consumed);
    if (drawing) {
      const from = consumed / length;
      const to = (consumed + step) / length;
      output.push(
        start.x + dx * from, start.y + dy * from, start.z + dz * from,
        start.x + dx * to, start.y + dy * to, start.z + dz * to,
      );
    }
    consumed += step;
    remaining -= step;
    if (remaining <= 1e-8) {
      patternIndex = (patternIndex + 1) % edge.dashPattern.length;
      remaining = edge.dashPattern[patternIndex]!;
      drawing = patternIndex % 2 === 0;
    }
  }
  return new Float32Array(output);
}

export function createEdgeObject(edge: GraphEdge, emphasized: boolean, dimmed: boolean): LineSegments2 {
  const material = new LineMaterial({
    color: edge.color,
    linewidth: emphasized ? edge.width * 1.2 : edge.width,
    transparent: true,
    opacity: dimmed ? 0.035 : emphasized ? 0.94 : edge.kind === "semantic" ? 0.22 : 0.66,
    depthWrite: false,
    worldUnits: false,
  });
  material.resolution.set(typeof window === "undefined" ? 1440 : window.innerWidth, typeof window === "undefined" ? 1000 : window.innerHeight);
  const object = new LineSegments2(new LineSegmentsGeometry(), material);
  object.userData.edge = edge;
  object.userData.baseOpacity = material.opacity;
  return object;
}

export function updateEdgeAppearance(object: THREE.Object3D, edge: GraphEdge, emphasized: boolean, dimmed: boolean): void {
  if (!(object instanceof LineSegments2)) return;
  object.material.linewidth = emphasized ? edge.width * 1.2 : edge.width;
  object.material.opacity = dimmed ? 0.035 : emphasized ? 0.94 : edge.kind === "semantic" ? 0.22 : 0.66;
  object.userData.baseOpacity = object.material.opacity;
  object.material.needsUpdate = true;
}

export function updateEdgeObject(object: THREE.Object3D, coordinates: { start: Point; end: Point }, edge: GraphEdge) {
  if (!(object instanceof LineSegments2)) return false;
  const signature = [coordinates.start.x, coordinates.start.y, coordinates.start.z, coordinates.end.x, coordinates.end.y, coordinates.end.z, edge.dashPattern.join(",")].join("|");
  if (object.userData.signature === signature) return true;
  object.userData.signature = signature;
  object.geometry.setPositions(edgeSegmentPositions(edge, coordinates.start, coordinates.end));
  object.geometry.computeBoundingSphere();
  if (edge.dashPattern.length) object.computeLineDistances();
  return true;
}
