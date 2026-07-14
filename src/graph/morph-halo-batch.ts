import * as THREE from "three";

export interface MorphHaloBatch {
  object: THREE.Group;
  update: () => void;
  dispose: () => void;
}

interface LayerBatch {
  sources: THREE.Mesh[];
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  positions: Float32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
  opacityBoost: number;
}

export function createMorphHaloBatch(sources: THREE.Mesh[]): MorphHaloBatch | null {
  const innerSources = sources.filter((source) => source.userData.haloLayer === "inner");
  const outerSources = sources.filter((source) => source.userData.haloLayer === "outer");
  if (!innerSources.length && !outerSources.length) return null;

  const template = new THREE.SphereGeometry(1, 10, 7).toNonIndexed();
  const basePositions = new Float32Array((template.getAttribute("position").array as Float32Array));
  template.dispose();
  const group = new THREE.Group();
  group.name = "morph-halo-batch";
  group.renderOrder = -10;
  const layers: LayerBatch[] = [];

  const addLayer = (layerSources: THREE.Mesh[], outer: boolean) => {
    if (!layerSources.length) return;
    const opacityBoost = outer ? 1.6 : 1.5;
    const sourceMaximumOpacity = Math.max(...layerSources.map((source) => (source.material as THREE.MeshBasicMaterial).opacity));
    const positions = new Float32Array(basePositions.length * layerSources.length);
    const colors = new Float32Array(basePositions.length * layerSources.length);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: Math.min(0.16, sourceMaximumOpacity * opacityBoost),
      depthWrite: false,
      side: THREE.BackSide,
      blending: outer ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = outer ? "morph-halo-outer-batch" : "morph-halo-inner-batch";
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    group.add(mesh);
    layers.push({ sources: layerSources, mesh, positions, colors, opacityBoost });
  };
  addLayer(innerSources, false);
  addLayer(outerSources, true);

  const color = new THREE.Color();
  const update = () => {
    for (const layer of layers) {
      const sourceMaximumOpacity = Math.max(0.0001, ...layer.sources.map((source) => (source.material as THREE.MeshBasicMaterial).opacity));
      layer.mesh.material.opacity = Math.min(0.16, sourceMaximumOpacity * layer.opacityBoost);
      let offset = 0;
      for (const source of layer.sources) {
        const sourceMaterial = source.material as THREE.MeshBasicMaterial;
        color.copy(sourceMaterial.color).multiplyScalar(sourceMaterial.opacity / sourceMaximumOpacity);
        for (let vertex = 0; vertex < basePositions.length; vertex += 3) {
          layer.positions[offset] = source.position.x + basePositions[vertex]! * source.scale.x;
          layer.positions[offset + 1] = source.position.y + basePositions[vertex + 1]! * source.scale.y;
          layer.positions[offset + 2] = source.position.z + basePositions[vertex + 2]! * source.scale.z;
          layer.colors[offset] = color.r;
          layer.colors[offset + 1] = color.g;
          layer.colors[offset + 2] = color.b;
          offset += 3;
        }
      }
      layer.mesh.geometry.getAttribute("position").needsUpdate = true;
      layer.mesh.geometry.getAttribute("color").needsUpdate = true;
    }
  };
  update();

  return {
    object: group,
    update,
    dispose: () => {
      for (const layer of layers) {
        layer.mesh.geometry.dispose();
        layer.mesh.material.dispose();
      }
    },
  };
}
