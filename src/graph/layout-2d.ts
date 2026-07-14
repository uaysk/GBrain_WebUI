import { NODE_COLLISION_GAP, NODE_RADIUS_SCALE, type GraphNode } from "../types";

export type MapViewMode = "3d" | "2d";

export interface LayoutPoint {
  x: number;
  y: number;
  z: number;
}

export interface CommunityDisc {
  id: string;
  center: { x: number; y: number };
  radius: number;
}

export interface Map2DLayout {
  positions: Record<string, LayoutPoint>;
  communityDiscs: CommunityDisc[];
  looseNodeIds: string[];
  extent: number;
  minimumNodeGap: number;
  minimumCommunityGap: number;
}

const GROUP_GAP = 14;
const HALO_PADDING = 6;
const OUTER_HALO_SCALE = 1.16;

function direction2D(left: number, right: number): [number, number] {
  const angle = ((left + 1) * 2.399963 + (right + 1) * 1.618034) % (Math.PI * 2);
  return [Math.cos(angle), Math.sin(angle)];
}

function projectIsometric(node: Pick<GraphNode, "x" | "y" | "z">): [number, number] {
  return [(node.x - node.z) * 0.8660254, node.y + (node.x + node.z) * 0.5];
}

function relaxCircles(
  initial: Array<[number, number]>,
  radii: number[],
  iterations: number,
  gap: number,
): Array<[number, number]> {
  const points = initial.map((point) => [...point] as [number, number]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shifts = points.map(() => [0, 0] as [number, number]);
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const dx = points[right]![0] - points[left]![0];
        const dy = points[right]![1] - points[left]![1];
        const distance = Math.hypot(dx, dy);
        const required = (radii[left] ?? 0) + (radii[right] ?? 0) + gap;
        if (distance >= required) continue;
        const direction = distance < 1e-8 ? direction2D(left, right) : [dx / distance, dy / distance];
        const force = (required - distance) * 0.32;
        shifts[left]![0] -= direction[0]! * force;
        shifts[left]![1] -= direction[1]! * force;
        shifts[right]![0] += direction[0]! * force;
        shifts[right]![1] += direction[1]! * force;
      }
    }
    for (let index = 0; index < points.length; index += 1) {
      points[index]![0] += shifts[index]![0];
      points[index]![1] += shifts[index]![1];
    }
  }
  return points;
}

function centerPoints(points: Array<[number, number]>): Array<[number, number]> {
  if (!points.length) return [];
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return points.map(([x, y]) => [x - centerX, y - centerY]);
}

interface PackedCommunity {
  id: string;
  nodes: GraphNode[];
  local: Array<[number, number]>;
  desiredCenter: [number, number];
  radius: number;
}

function prepareCommunities(nodes: GraphNode[]): PackedCommunity[] {
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.hasEmbedding || node.isUnclassified) continue;
    grouped.set(node.groupId, [...(grouped.get(node.groupId) ?? []), node]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, members]) => {
    const projected = members.map(projectIsometric);
    const desiredCenter: [number, number] = [
      projected.reduce((sum, point) => sum + point[0], 0) / projected.length,
      projected.reduce((sum, point) => sum + point[1], 0) / projected.length,
    ];
    const initialLocal = projected.map(([x, y]) => [x - desiredCenter[0], y - desiredCenter[1]] as [number, number]);
    const radii = members.map((node) => NODE_RADIUS_SCALE * node.size);
    let local = centerPoints(relaxCircles(initialLocal, radii, 96, NODE_COLLISION_GAP));
    const minimumX = Math.min(...local.map((point) => point[0]));
    const maximumX = Math.max(...local.map((point) => point[0]));
    const minimumY = Math.min(...local.map((point) => point[1]));
    const maximumY = Math.max(...local.map((point) => point[1]));
    const boundsCenter: [number, number] = [(minimumX + maximumX) / 2, (minimumY + maximumY) / 2];
    local = local.map(([x, y]) => [x - boundsCenter[0], y - boundsCenter[1]]);
    const haloRadiusX = Math.max(7, (maximumX - minimumX) / 2 + HALO_PADDING) * OUTER_HALO_SCALE;
    const haloRadiusY = Math.max(7, (maximumY - minimumY) / 2 + HALO_PADDING) * OUTER_HALO_SCALE;
    return { id, nodes: members, local, desiredCenter, radius: Math.max(haloRadiusX, haloRadiusY) };
  });
}

function packCommunityCenters(communities: PackedCommunity[]): Array<[number, number]> {
  if (!communities.length) return [];
  const desiredMean: [number, number] = [
    communities.reduce((sum, community) => sum + community.desiredCenter[0], 0) / communities.length,
    communities.reduce((sum, community) => sum + community.desiredCenter[1], 0) / communities.length,
  ];
  const desired = communities.map((community) => [
    community.desiredCenter[0] - desiredMean[0],
    community.desiredCenter[1] - desiredMean[1],
  ] as [number, number]);
  let centers = desired.map((point) => [...point] as [number, number]);

  for (let iteration = 0; iteration < 360; iteration += 1) {
    const shifts = centers.map(() => [0, 0] as [number, number]);
    for (let left = 0; left < centers.length; left += 1) {
      for (let right = left + 1; right < centers.length; right += 1) {
        const dx = centers[right]![0] - centers[left]![0];
        const dy = centers[right]![1] - centers[left]![1];
        const distance = Math.hypot(dx, dy);
        const required = communities[left]!.radius + communities[right]!.radius + GROUP_GAP;
        if (distance >= required) continue;
        const direction = distance < 1e-8 ? direction2D(left, right) : [dx / distance, dy / distance];
        const force = (required - distance) * 0.28;
        shifts[left]![0] -= direction[0]! * force;
        shifts[left]![1] -= direction[1]! * force;
        shifts[right]![0] += direction[0]! * force;
        shifts[right]![1] += direction[1]! * force;
      }
    }
    const anchorStrength = iteration < 240 ? 0.002 : 0;
    centers = centers.map(([x, y], index) => [
      x + shifts[index]![0] + (desired[index]![0] - x) * anchorStrength,
      y + shifts[index]![1] + (desired[index]![1] - y) * anchorStrength,
    ]);
  }
  return centerPoints(centers);
}

function minimumNodeSurfaceGap(nodes: GraphNode[], positions: Record<string, LayoutPoint>): number {
  if (nodes.length < 2) return 0;
  let minimum = Infinity;
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left]!;
      const b = nodes[right]!;
      const pa = positions[a.id]!;
      const pb = positions[b.id]!;
      minimum = Math.min(minimum,
        Math.hypot(pa.x - pb.x, pa.y - pb.y) - NODE_RADIUS_SCALE * a.size - NODE_RADIUS_SCALE * b.size,
      );
    }
  }
  return minimum;
}

export function createMap2DLayout(nodes: GraphNode[]): Map2DLayout {
  const stableNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const communities = prepareCommunities(stableNodes);
  const centers = packCommunityCenters(communities);
  const positions: Record<string, LayoutPoint> = {};
  const communityDiscs = communities.map((community, groupIndex) => {
    const center = centers[groupIndex]!;
    community.nodes.forEach((node, nodeIndex) => {
      const local = community.local[nodeIndex]!;
      positions[node.id] = { x: center[0] + local[0], y: center[1] + local[1], z: 0 };
    });
    return { id: community.id, center: { x: center[0], y: center[1] }, radius: community.radius };
  });

  const looseNodes = stableNodes.filter((node) => !node.hasEmbedding || node.isUnclassified);
  const maximumLooseRadius = Math.max(0, ...looseNodes.map((node) => NODE_RADIUS_SCALE * node.size));
  const packedExtent = Math.max(0, ...communityDiscs.map((disc) => Math.hypot(disc.center.x, disc.center.y) + disc.radius));
  if (looseNodes.length) {
    const chordDenominator = looseNodes.length > 1 ? 2 * Math.sin(Math.PI / looseNodes.length) : 1;
    const collisionRadius = (2 * maximumLooseRadius + NODE_COLLISION_GAP) / Math.max(0.001, chordDenominator);
    const ringRadius = Math.max(packedExtent + GROUP_GAP + maximumLooseRadius + 8, collisionRadius);
    looseNodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / looseNodes.length;
      positions[node.id] = { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius, z: 0 };
    });
  }

  const extent = Math.max(1, ...stableNodes.map((node) => {
    const point = positions[node.id]!;
    return Math.hypot(point.x, point.y) + NODE_RADIUS_SCALE * node.size;
  }));
  let minimumCommunityGap = 0;
  if (communityDiscs.length > 1) {
    minimumCommunityGap = Infinity;
    for (let left = 0; left < communityDiscs.length; left += 1) {
      for (let right = left + 1; right < communityDiscs.length; right += 1) {
        const a = communityDiscs[left]!;
        const b = communityDiscs[right]!;
        minimumCommunityGap = Math.min(minimumCommunityGap,
          Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) - a.radius - b.radius,
        );
      }
    }
  }
  return {
    positions,
    communityDiscs,
    looseNodeIds: looseNodes.map((node) => node.id),
    extent,
    minimumNodeGap: minimumNodeSurfaceGap(stableNodes, positions),
    minimumCommunityGap,
  };
}

export function easeInOutCubic(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - ((-2 * clamped + 2) ** 3) / 2;
}
