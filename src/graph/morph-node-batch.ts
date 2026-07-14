import * as THREE from "three";
import { NODE_RADIUS_SCALE, NODE_SELECTED_SCALE, type GraphNode, type NodeShape } from "../types";

const SHAPE_SIDES: Record<NodeShape, number> = {
  circle: 0,
  triangle: 3,
  square: 4,
  diamond: 4,
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
};

const SHAPE_ROTATION: Record<NodeShape, number> = {
  circle: 0,
  triangle: -Math.PI / 2,
  square: -Math.PI / 4,
  diamond: -Math.PI / 2,
  pentagon: -Math.PI / 2,
  hexagon: 0,
  octagon: Math.PI / 8,
};

export interface MorphNodeBatch {
  object: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  updatePositions: (nodes: GraphNode[]) => void;
  dispose: () => void;
}

export function createMorphNodeBatch(
  nodes: GraphNode[],
  selectedId: string | null,
  neighbors: Set<string>,
  viewportHeight: number,
): MorphNodeBatch {
  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const shapeSides = new Float32Array(nodes.length);
  const shapeRotations = new Float32Array(nodes.length);
  const opacities = new Float32Array(nodes.length);
  const filled = new Float32Array(nodes.length);
  const emphasis = new Float32Array(nodes.length);
  const color = new THREE.Color();

  nodes.forEach((node, index) => {
    color.set(node.color);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    const selected = node.id === selectedId;
    const adjacent = Boolean(selectedId && neighbors.has(node.id) && !selected);
    sizes[index] = NODE_RADIUS_SCALE * node.size * 2 * (selected ? NODE_SELECTED_SCALE : 1);
    shapeSides[index] = SHAPE_SIDES[node.shape];
    shapeRotations[index] = SHAPE_ROTATION[node.shape];
    opacities[index] = selectedId && !neighbors.has(node.id) ? 0.13 : 0.96;
    filled[index] = node.hasEmbedding ? 1 : 0;
    emphasis[index] = selected ? 2 : adjacent ? 1 : 0;
  });

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aShapeSides", new THREE.BufferAttribute(shapeSides, 1));
  geometry.setAttribute("aShapeRotation", new THREE.BufferAttribute(shapeRotations, 1));
  geometry.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute("aFilled", new THREE.BufferAttribute(filled, 1));
  geometry.setAttribute("aEmphasis", new THREE.BufferAttribute(emphasis, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uViewportHeight: { value: viewportHeight } },
    vertexShader: `
      uniform float uViewportHeight;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aShapeSides;
      attribute float aShapeRotation;
      attribute float aOpacity;
      attribute float aFilled;
      attribute float aEmphasis;
      varying vec3 vColor;
      varying float vShapeSides;
      varying float vShapeRotation;
      varying float vOpacity;
      varying float vFilled;
      varying float vEmphasis;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(1.0, aSize * uViewportHeight * projectionMatrix[1][1] / max(1.0, -2.0 * viewPosition.z));
        vColor = aColor;
        vShapeSides = aShapeSides;
        vShapeRotation = aShapeRotation;
        vOpacity = aOpacity;
        vFilled = aFilled;
        vEmphasis = aEmphasis;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vShapeSides;
      varying float vShapeRotation;
      varying float vOpacity;
      varying float vFilled;
      varying float vEmphasis;

      void main() {
        vec2 point = gl_PointCoord * 2.0 - 1.0;
        float metric = length(point);
        if (vShapeSides > 2.5) {
          float angle = atan(point.y, point.x) - vShapeRotation;
          float sector = 6.28318530718 / vShapeSides;
          metric *= cos(floor(0.5 + angle / sector) * sector - angle);
        }
        float radius = 0.72;
        float antialias = max(fwidth(metric), 0.008);
        float shapeAlpha = 1.0 - smoothstep(radius - antialias, radius + antialias, metric);
        if (shapeAlpha <= 0.001) discard;

        float border = smoothstep(radius - 0.14 - antialias, radius - 0.07 + antialias, metric);
        vec3 outputColor = vColor;
        float outputAlpha = vOpacity * shapeAlpha;
        if (vFilled < 0.5) outputAlpha *= mix(0.16, 1.0, border);
        if (vEmphasis > 0.5 && border > 0.2) {
          outputColor = mix(outputColor, vec3(1.0), vEmphasis > 1.5 ? 0.96 : 0.58);
        }
        gl_FragColor = vec4(outputColor, outputAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const object = new THREE.Points(geometry, material);
  object.name = "morph-node-batch";
  object.frustumCulled = false;
  object.renderOrder = 10;

  const updatePositions = (nextNodes: GraphNode[]) => {
    nextNodes.forEach((node, index) => {
      positions[index * 3] = Number(node.x ?? 0);
      positions[index * 3 + 1] = Number(node.y ?? 0);
      positions[index * 3 + 2] = Number(node.z ?? 0);
    });
    positionAttribute.needsUpdate = true;
  };
  updatePositions(nodes);

  return {
    object,
    updatePositions,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
