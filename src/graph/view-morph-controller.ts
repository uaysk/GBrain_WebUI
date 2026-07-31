import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

/** Stable ID registries used for in-place view morph updates. */
export class ViewMorphController {
  readonly nodeObjectById = new Map<string, THREE.Object3D>();
  readonly edgeObjects: LineSegments2[] = [];
  readonly labelByGroupId = new Map<string, HTMLElement>();

  capture(scene: THREE.Scene | undefined, labelLayer: HTMLElement | null): void {
    this.nodeObjectById.clear();
    this.edgeObjects.length = 0;
    scene?.traverse((object) => {
      if (object.name === "memory-node-object" && typeof object.userData.nodeId === "string") {
        this.nodeObjectById.set(object.userData.nodeId, object);
      }
      if (object instanceof LineSegments2 && object.userData.edge) this.edgeObjects.push(object);
    });
    this.captureLabels(labelLayer);
  }

  captureLabels(labelLayer: HTMLElement | null): void {
    this.labelByGroupId.clear();
    for (const element of labelLayer?.querySelectorAll<HTMLElement>("[data-group-label]") ?? []) {
      if (element.dataset.groupLabel) this.labelByGroupId.set(element.dataset.groupLabel, element);
    }
  }
}
