import * as THREE from "three";
import type { GraphNode, NodeShape } from "../types";

export interface BillboardState {
  selected: boolean;
  adjacent: boolean;
  dimmed: boolean;
  historyChanged?: boolean;
  dreamAffected?: boolean;
}

const POLYGON_SIDES: Partial<Record<NodeShape, number>> = {
  triangle: 3,
  square: 4,
  diamond: 4,
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
};

const ROTATION: Partial<Record<NodeShape, number>> = {
  triangle: -Math.PI / 2,
  square: -Math.PI / 4,
  diamond: -Math.PI / 2,
  pentagon: -Math.PI / 2,
  hexagon: 0,
  octagon: Math.PI / 8,
};

export function billboardVertices(shape: NodeShape): Array<[number, number]> {
  const sides = POLYGON_SIDES[shape];
  if (!sides) return [];
  const rotation = ROTATION[shape] ?? -Math.PI / 2;
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return [Math.cos(angle), Math.sin(angle)];
  });
}

function traceShape(context: CanvasRenderingContext2D, shape: NodeShape, radius: number) {
  context.beginPath();
  if (shape === "circle") {
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.closePath();
    return;
  }
  const points = billboardVertices(shape);
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x * radius, y * radius);
    else context.lineTo(x * radius, y * radius);
  });
  context.closePath();
}

function textureKey(node: GraphNode, state: BillboardState): string {
  const emphasis = state.selected ? "selected" : state.adjacent ? "adjacent" : "default";
  return [
    node.shape,
    node.color,
    node.hasEmbedding ? "filled" : "outline",
    emphasis,
    state.historyChanged ? "changed" : "steady",
    state.dreamAffected ? "dream-affected" : "dream-steady",
  ].join("|");
}

function renderBillboardTexture(node: GraphNode, state: BillboardState): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  context.translate(80, 80);
  context.lineJoin = "round";
  context.lineCap = "round";

  const radius = 58;
  if (state.historyChanged) {
    traceShape(context, node.shape, 69);
    context.strokeStyle = "rgba(34,211,238,0.92)";
    context.lineWidth = 6;
    context.stroke();
  }
  if (state.dreamAffected) {
    traceShape(context, node.shape, state.historyChanged ? 75 : 69);
    context.strokeStyle = "rgba(244,114,182,0.96)";
    context.lineWidth = 6;
    context.stroke();
  }
  traceShape(context, node.shape, radius);
  if (state.selected || state.adjacent) {
    context.strokeStyle = state.selected ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.46)";
    context.lineWidth = state.selected ? 12 : 8;
    context.stroke();
  }

  traceShape(context, node.shape, radius);
  if (node.hasEmbedding) {
    context.fillStyle = node.color;
    context.fill();
    context.strokeStyle = "rgba(8,8,8,0.92)";
    context.lineWidth = 3;
    context.stroke();
  } else {
    context.fillStyle = "rgba(8,8,8,0.16)";
    context.fill();
    context.setLineDash([10, 7]);
    context.strokeStyle = node.color;
    context.lineWidth = 6;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class BillboardTexturePool {
  private readonly bases = new Map<string, THREE.CanvasTexture>();
  private readonly clones = new Set<THREE.Texture>();

  signature(node: GraphNode, state: BillboardState): string {
    return textureKey(node, state);
  }

  acquire(node: GraphNode, state: BillboardState): THREE.Texture {
    const key = textureKey(node, state);
    let base = this.bases.get(key);
    if (!base) {
      base = renderBillboardTexture(node, state);
      this.bases.set(key, base);
    }
    const texture = base.clone();
    texture.needsUpdate = true;
    this.clones.add(texture);
    return texture;
  }

  release(texture: THREE.Texture | null | undefined): void {
    if (!texture || !this.clones.delete(texture)) return;
    texture.dispose();
  }

  dispose(): void {
    for (const texture of this.clones) texture.dispose();
    for (const texture of this.bases.values()) texture.dispose();
    this.clones.clear();
    this.bases.clear();
  }
}

export function createNodeBillboard(node: GraphNode, state: BillboardState, diameter: number, pool: BillboardTexturePool): THREE.Sprite {
  const texture = pool.acquire(node, state);
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: "#ffffff",
    transparent: true,
    alphaTest: 0.02,
    opacity: state.dimmed ? 0.13 : 0.96,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "node-billboard";
  sprite.renderOrder = 10;
  sprite.scale.set(diameter, diameter, 1);
  sprite.userData.billboard = true;
  sprite.userData.textureSignature = pool.signature(node, state);
  return sprite;
}
