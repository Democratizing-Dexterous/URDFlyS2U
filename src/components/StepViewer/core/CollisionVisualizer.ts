import * as THREE from "three";
import type { CollisionShape } from "../types";
import { shapeLocalMatrix } from "./CollisionSimplifier";

export interface CollisionVisualizerConfig {
  scene: THREE.Scene;
}

export class CollisionVisualizer {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private objects = new Map<string, THREE.Object3D>();

  constructor(config: CollisionVisualizerConfig) {
    this.scene = config.scene;
    this.group = new THREE.Group();
    this.group.name = "collision-preview";
    this.group.renderOrder = 999;
    this.scene.add(this.group);
  }

  setShapes(shapes: CollisionShape[]): void {
    this.clear();
    for (const shape of shapes) {
      const geometry = this.createGeometry(shape);
      if (!geometry) continue;

      const container = new THREE.Group();
      container.matrixAutoUpdate = false;

      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.9 }),
      );

      container.add(fill);
      container.add(edges);
      container.matrix.copy(shapeLocalMatrix(shape));
      container.matrixWorldNeedsUpdate = true;

      this.group.add(container);
      this.objects.set(shape.linkId, container);
    }
  }

  updateTransforms(shapes: CollisionShape[], deltas: Map<string, THREE.Matrix4>): void {
    for (const shape of shapes) {
      const obj = this.objects.get(shape.linkId);
      if (!obj) continue;
      const m = shapeLocalMatrix(shape);
      const delta = deltas.get(shape.linkId);
      if (delta) m.premultiply(delta);
      obj.matrix.copy(m);
      obj.matrixWorldNeedsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  clear(): void {
    for (const obj of this.objects.values()) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      this.group.remove(obj);
    }
    this.objects.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }

  private createGeometry(shape: CollisionShape): THREE.BufferGeometry | null {
    switch (shape.type) {
      case "box":
        return new THREE.BoxGeometry(
          shape.halfExtents[0] * 2,
          shape.halfExtents[1] * 2,
          shape.halfExtents[2] * 2,
        );
      case "sphere":
        return new THREE.SphereGeometry(shape.radius, 20, 14);
      case "cylinder": {
        const geo = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.height, 28);
        geo.rotateX(Math.PI / 2);
        return geo;
      }
      default:
        return null;
    }
  }
}
