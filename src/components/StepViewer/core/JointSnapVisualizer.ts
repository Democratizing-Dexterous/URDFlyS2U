import * as THREE from "three";
import { buildAxisFrame, flipAxisFrame, type AxisFrame, type FrameAxis } from "./AxisFrame";

export interface JointSnapVisualizerConfig {
  scene: THREE.Scene;
  axisLength?: number;
}

export class JointSnapVisualizer {
  private scene: THREE.Scene;
  private axisLength: number;
  private group: THREE.Group;
  private xArrow: THREE.ArrowHelper;
  private yArrow: THREE.ArrowHelper;
  private zArrow: THREE.ArrowHelper;
  private axisLine: THREE.Line;
  private originDot: THREE.Mesh;
  private visible = false;

  private currentNormal = new THREE.Vector3(0, 0, 1);
  private currentPosition = new THREE.Vector3();
  private currentFrame: AxisFrame = buildAxisFrame([0, 0, 1]);

  constructor(config: JointSnapVisualizerConfig) {
    this.scene = config.scene;
    this.axisLength = config.axisLength ?? 0.05;

    const len = this.axisLength;

    this.xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      len,
      0xff0000,
      len * 0.2,
      len * 0.1,
    );
    this.yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      len,
      0x00ff00,
      len * 0.2,
      len * 0.1,
    );
    this.zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      len,
      0x0000ff,
      len * 0.2,
      len * 0.1,
    );

    this.group = new THREE.Group();
    this.group.name = "snap-gizmo";
    this.group.add(this.xArrow, this.yArrow, this.zArrow);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 1),
    ]);
    this.axisLine = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color: 0x00e5ff,
        dashSize: len * 0.3,
        gapSize: len * 0.2,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.axisLine.computeLineDistances();
    this.axisLine.renderOrder = 997;
    this.axisLine.visible = false;
    this.group.add(this.axisLine);

    this.originDot = new THREE.Mesh(
      new THREE.SphereGeometry(len * 0.08, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true }),
    );
    this.originDot.renderOrder = 999;
    this.group.add(this.originDot);

    this.group.visible = false;
    this.group.matrixAutoUpdate = false;

    this.scene.add(this.group);
  }

  showAxisLine(halfLength: number): void {
    this.axisLine.scale.set(1, 1, Math.max(halfLength, 1e-6));
    const mat = this.axisLine.material as THREE.LineDashedMaterial;
    mat.dashSize = halfLength * 0.04;
    mat.gapSize = halfLength * 0.025;
    this.axisLine.computeLineDistances();
    this.axisLine.visible = true;
  }

  hideAxisLine(): void {
    this.axisLine.visible = false;
  }

  updateSnap(position: THREE.Vector3, normal: THREE.Vector3): void {
    this.currentPosition.copy(position);
    this.currentNormal.copy(normal).normalize();
    this.currentFrame = buildAxisFrame([
      this.currentNormal.x,
      this.currentNormal.y,
      this.currentNormal.z,
    ]);
    this.applyTransform();
    this.group.visible = true;
    this.visible = true;
  }

  flipAxis(axis: FrameAxis): void {
    this.currentFrame = flipAxisFrame(this.currentFrame, axis);
    this.currentNormal.set(this.currentFrame.z[0], this.currentFrame.z[1], this.currentFrame.z[2]);
    this.applyTransform();
  }

  getCurrentFrame(): AxisFrame {
    return {
      x: [...this.currentFrame.x] as [number, number, number],
      y: [...this.currentFrame.y] as [number, number, number],
      z: [...this.currentFrame.z] as [number, number, number],
    };
  }

  getCurrentNormal(): THREE.Vector3 {
    return this.currentNormal.clone();
  }

  getCurrentPosition(): THREE.Vector3 {
    return this.currentPosition.clone();
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.group.visible = false;
    this.axisLine.visible = false;
    this.visible = false;
  }

  private applyTransform(): void {
    const { x, y, z } = this.currentFrame;

    const m = this.group.matrix;
    m.set(
      x[0],
      y[0],
      z[0],
      this.currentPosition.x,
      x[1],
      y[1],
      z[1],
      this.currentPosition.y,
      x[2],
      y[2],
      z[2],
      this.currentPosition.z,
      0,
      0,
      0,
      1,
    );
    this.group.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.hide();
    this.scene.remove(this.group);

    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat?.dispose();
        }
      }
    });
  }
}
