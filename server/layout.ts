import { UMAP } from "umap-js";

export function parseVector(value: string): number[] {
  if (!value.startsWith("[") || !value.endsWith("]")) throw new Error("Invalid pgvector text representation");
  return value.slice(1, -1).split(",").map(Number);
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function projectUmap(vectors: number[][]): number[][] {
  if (vectors.length < 4) return vectors.map((_, i) => [Math.cos(i * Math.PI), Math.sin(i * Math.PI), 0]);
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(15, vectors.length - 1),
    minDist: 0.2,
    spread: 1.15,
    random: mulberry32(42),
  });
  const raw = umap.fit(vectors);
  return normalizeCoordinates(raw, 82);
}

export function normalizeCoordinates(coords: number[][], extent: number): number[][] {
  const dimensions = [0, 1, 2].map((axis) => coords.map((v) => v[axis] ?? 0));
  const centers = dimensions.map((v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0);
  const centered = coords.map((v) => v.map((n, axis) => n - (centers[axis] ?? 0)));
  const maxRadius = Math.max(1, ...centered.map((v) => Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)));
  return centered.map((v) => v.map((n) => (n / maxRadius) * extent));
}

const distance3 = (a: number[], b: number[]) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

function deterministicDirection(left: number, right: number): number[] {
  const angle = ((left + 1) * 2.399963 + (right + 1) * 1.618034) % (Math.PI * 2);
  const z = (((left + 1) * 37 + (right + 1) * 17) % 19) / 9 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(angle) * radial, Math.sin(angle) * radial, z];
}

export function separateSemanticGroups(coords: number[][], assignments: number[], gap = 20): number[][] {
  if (coords.length !== assignments.length || coords.length === 0) return coords.map((point) => [...point]);
  const count = Math.max(-1, ...assignments) + 1;
  if (count === 0) return normalizeCoordinates(coords, 108);
  const members = Array.from({ length: count }, () => [] as number[]);
  assignments.forEach((group, index) => members[group]?.push(index));
  const originalCenters = members.map((indices) => [0, 1, 2].map((axis) => indices.reduce((sum, index) => sum + (coords[index]?.[axis] ?? 0), 0) / Math.max(1, indices.length)));
  const localScale = 0.72;
  const radii = members.map((indices, group) => {
    const distances = indices.map((index) => distance3(coords[index]!, originalCenters[group]!)).sort((a, b) => a - b);
    return Math.max(5, (distances[Math.floor(distances.length * 0.9)] ?? 0) * localScale);
  });
  const centers = originalCenters.map((center, group) => {
    const direction = deterministicDirection(group, count);
    return center.map((value, axis) => value + (direction[axis] ?? 0) * 0.8);
  });

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const shifts = centers.map(() => [0, 0, 0]);
    for (let left = 0; left < centers.length; left += 1) {
      for (let right = left + 1; right < centers.length; right += 1) {
        const delta = centers[right]!.map((value, axis) => value - (centers[left]?.[axis] ?? 0));
        const distance = Math.hypot(...delta);
        const required = (radii[left] ?? 0) + (radii[right] ?? 0) + gap;
        if (distance >= required) continue;
        const direction = distance < 1e-6 ? deterministicDirection(left, right) : delta.map((value) => value / distance);
        const force = (required - distance) * 0.28;
        direction.forEach((value, axis) => {
          shifts[left]![axis] = (shifts[left]?.[axis] ?? 0) - value * force;
          shifts[right]![axis] = (shifts[right]?.[axis] ?? 0) + value * force;
        });
      }
    }
    centers.forEach((center, group) => center.forEach((value, axis) => {
      const anchor = ((originalCenters[group]?.[axis] ?? 0) - value) * 0.004;
      center[axis] = value + (shifts[group]?.[axis] ?? 0) + anchor;
    }));
  }

  const separated = coords.map((point, index) => {
    const group = assignments[index] ?? 0;
    if (group < 0) return [...point];
    return point.map((value, axis) => (centers[group]?.[axis] ?? 0) + (value - (originalCenters[group]?.[axis] ?? 0)) * localScale);
  });
  return normalizeCoordinates(separated, 108);
}

export function placeUnclassifiedNearGraph(coords: number[][], unclassified: boolean[], radius = 72): number[][] {
  if (coords.length !== unclassified.length) return coords.map((point) => [...point]);
  const count = unclassified.filter(Boolean).length;
  if (count === 0) return coords.map((point) => [...point]);
  let ordinal = 0;
  return coords.map((point, index) => {
    if (!unclassified[index]) return [...point];
    const angle = -Math.PI / 2 + (ordinal * Math.PI * 2) / count;
    const ringRadius = radius + ((ordinal % 3) - 1) * 4;
    const depth = ((ordinal % 3) - 1) * 8;
    ordinal += 1;
    return [Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, depth];
  });
}

export function relaxNodeCollisions(coords: number[][], minimumDistance: number | number[] = 4.8, iterations = 16, gap = 0): number[][] {
  const points = coords.map((point) => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const delta = points[right]!.map((value, axis) => value - (points[left]?.[axis] ?? 0));
        const distance = Math.hypot(...delta);
        const required = Array.isArray(minimumDistance)
          ? (minimumDistance[left] ?? 0) + (minimumDistance[right] ?? 0) + gap
          : minimumDistance;
        if (distance >= required) continue;
        const direction = distance < 1e-6 ? deterministicDirection(left, right) : delta.map((value) => value / distance);
        const force = (required - distance) * 0.3;
        direction.forEach((value, axis) => {
          points[left]![axis] = (points[left]?.[axis] ?? 0) - value * force;
          points[right]![axis] = (points[right]?.[axis] ?? 0) + value * force;
        });
      }
    }
  }
  return points;
}
