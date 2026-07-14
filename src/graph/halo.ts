import * as THREE from "three";

export function nodesInCommunityHalo<T extends { groupId: string; hasEmbedding: boolean }>(
  nodes: readonly T[],
  groupId: string,
): T[] {
  return nodes.filter((node) => node.groupId === groupId && node.hasEmbedding);
}

export function haloTransformForNodes(
  members: Array<{ x?: number; y?: number; z?: number }>,
  flatness: number,
): { center: [number, number, number]; radii: [number, number, number] } | null {
  if (!members.length) return null;
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of members) {
    const point = [Number(node.x ?? 0), Number(node.y ?? 0), Number(node.z ?? 0)];
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
    }
  }
  const center = minimum.map((value, axis) => (value + maximum[axis]!) / 2) as [number, number, number];
  const volumeRadii = minimum.map((value, axis) => Math.max(7, (maximum[axis]! - value) / 2 + 6)) as [number, number, number];
  return {
    center,
    radii: [volumeRadii[0], volumeRadii[1], volumeRadii[2] * (1 - flatness) + 1.35 * flatness],
  };
}

export function createCommunityHaloMeshes(groupId: string, color: string): THREE.Mesh[] {
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  const inner = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.BackSide,
  }));
  inner.userData.groupId = groupId;
  inner.userData.haloGroupId = groupId;
  inner.userData.haloLayer = "inner";
  inner.userData.baseOpacity = inner.material.opacity;
  inner.name = "community-halo-hit-target";
  const outer = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.038, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
  }));
  outer.userData.haloGroupId = groupId;
  outer.userData.haloLayer = "outer";
  outer.userData.baseOpacity = outer.material.opacity;
  return [inner, outer];
}

export function disposeHaloRoot(root: THREE.Group) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material.dispose();
  });
}
