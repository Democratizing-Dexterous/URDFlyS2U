import * as THREE from "three";
import type { URDFJoint } from "../types";

export interface FrameVisualizerConfig {
  scene: THREE.Scene;
  axisLength?: number;
}

const BASE_FRAME_ID = "__base__";
const BASE_FRAME_SCALE = 1.6;

const SHAFT_RADIUS = 0.025;
const HEAD_RADIUS = 0.065;
const HEAD_LENGTH = 0.22;
const SHAFT_LENGTH = 1 - HEAD_LENGTH;

let sharedShaftGeo: THREE.CylinderGeometry | null = null;
let sharedHeadGeo: THREE.ConeGeometry | null = null;
let sharedMaterials: {
  x: THREE.MeshBasicMaterial;
  y: THREE.MeshBasicMaterial;
  z: THREE.MeshBasicMaterial;
} | null = null;

function ensureSharedResources(): void {
  if (!sharedShaftGeo) {
    sharedShaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8, 1);
    sharedShaftGeo.translate(0, SHAFT_LENGTH / 2, 0);
  }
  if (!sharedHeadGeo) {
    sharedHeadGeo = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 8);
    sharedHeadGeo.translate(0, SHAFT_LENGTH + HEAD_LENGTH / 2, 0);
  }
  if (!sharedMaterials) {
    sharedMaterials = {
      x: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
      y: new THREE.MeshBasicMaterial({ color: 0x20cc20 }),
      z: new THREE.MeshBasicMaterial({ color: 0x2050ff }),
    };
  }
}

function makeAxisArrow(axis: "x" | "y" | "z"): THREE.Group {
  ensureSharedResources();
  const group = new THREE.Group();
  const mat = sharedMaterials![axis];
  group.add(new THREE.Mesh(sharedShaftGeo!, mat));
  group.add(new THREE.Mesh(sharedHeadGeo!, mat));
  if (axis === "x") group.rotation.z = -Math.PI / 2;
  else if (axis === "z") group.rotation.x = Math.PI / 2;
  return group;
}

function makeUnitFrame(): THREE.Group {
  const scaleGroup = new THREE.Group();
  scaleGroup.add(makeAxisArrow("x"), makeAxisArrow("y"), makeAxisArrow("z"));
  return scaleGroup;
}

interface FrameEntry {
  root: THREE.Group;
  scaleGroup: THREE.Group;
}

export class FrameVisualizer {
  private scene: THREE.Scene;
  private axisLength: number;
  private frameGroup: THREE.Group;
  private frames = new Map<string, FrameEntry>();

  constructor(config: FrameVisualizerConfig) {
    this.scene = config.scene;
    this.axisLength = config.axisLength ?? 0.05;
    this.frameGroup = new THREE.Group();
    this.frameGroup.name = "urdf-frames";
    this.scene.add(this.frameGroup);
  }

  private createFrame(id: string, scale: number): FrameEntry {
    const root = new THREE.Group();
    root.name = `frame_${id}`;
    const scaleGroup = makeUnitFrame();
    scaleGroup.scale.setScalar(scale);
    root.add(scaleGroup);

    const entry: FrameEntry = { root, scaleGroup };
    this.frames.set(id, entry);
    this.frameGroup.add(root);
    return entry;
  }

  showFrame(joint: URDFJoint): void {
    let entry = this.frames.get(joint.id);
    if (!entry) {
      entry = this.createFrame(joint.id, this.axisLength);
    }
    entry.root.matrixAutoUpdate = true;
    entry.root.position.set(...joint.origin.xyz);
    const [roll, pitch, yaw] = joint.origin.rpy;
    entry.root.setRotationFromEuler(new THREE.Euler(roll, pitch, yaw, "ZYX"));
  }

  updateFrameTransform(jointId: string, worldMatrix: THREE.Matrix4): void {
    const entry = this.frames.get(jointId);
    if (entry) {
      entry.root.matrixAutoUpdate = false;
      entry.root.matrix.copy(worldMatrix);
      entry.root.matrixWorldNeedsUpdate = true;
    }
  }

  hideFrame(jointId: string): void {
    const entry = this.frames.get(jointId);
    if (entry) {
      this.frameGroup.remove(entry.root);
      this.frames.delete(jointId);
    }
  }

  showAllFrames(joints: URDFJoint[]): void {
    const wanted = new Set(joints.map((j) => j.id));

    for (const id of Array.from(this.frames.keys())) {
      if (id !== BASE_FRAME_ID && !wanted.has(id)) {
        this.hideFrame(id);
      }
    }

    for (const joint of joints) {
      if (!this.frames.has(joint.id)) {
        this.showFrame(joint);
      }
    }
  }

  showBaseFrame(origin: [number, number, number] | null, rpy?: [number, number, number]): void {
    if (!origin) {
      this.hideFrame(BASE_FRAME_ID);
      return;
    }

    let entry = this.frames.get(BASE_FRAME_ID);
    if (!entry) {
      entry = this.createFrame(BASE_FRAME_ID, this.axisLength * BASE_FRAME_SCALE);
    }

    entry.root.matrixAutoUpdate = true;
    entry.root.position.set(origin[0], origin[1], origin[2]);
    if (rpy) {
      const [roll, pitch, yaw] = rpy;
      entry.root.setRotationFromEuler(new THREE.Euler(roll, pitch, yaw, "ZYX"));
    } else {
      entry.root.rotation.set(0, 0, 0);
    }
  }

  setVisible(visible: boolean): void {
    this.frameGroup.visible = visible;
  }

  setAxisLength(length: number): void {
    this.axisLength = length;
    this.frames.forEach((entry, id) => {
      const scale = id === BASE_FRAME_ID ? length * BASE_FRAME_SCALE : length;
      entry.scaleGroup.scale.setScalar(scale);
    });
  }

  clearAll(): void {
    this.frames.forEach((entry) => this.frameGroup.remove(entry.root));
    this.frames.clear();
  }

  dispose(): void {
    this.clearAll();
    this.scene.remove(this.frameGroup);
  }
}
