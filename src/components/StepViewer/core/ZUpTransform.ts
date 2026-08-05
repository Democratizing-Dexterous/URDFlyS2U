import * as THREE from "three";
import type { SerializedSolidData, InertialParams } from "../types";

export type UpAxis = "X+" | "X-" | "Y+" | "Y-" | "Z+" | "Z-";

export const UP_AXIS_OPTIONS: UpAxis[] = ["X+", "X-", "Y+", "Y-", "Z+", "Z-"];

const HALF_PI = Math.PI / 2;

export function upAxisToZUpMatrix(up: UpAxis): THREE.Matrix4 {
  switch (up) {
    case "Z+":
      return new THREE.Matrix4();
    case "Z-":
      return new THREE.Matrix4().makeRotationX(Math.PI);
    case "Y+":
      return new THREE.Matrix4().makeRotationX(HALF_PI);
    case "Y-":
      return new THREE.Matrix4().makeRotationX(-HALF_PI);
    case "X+":
      return new THREE.Matrix4().makeRotationY(-HALF_PI);
    case "X-":
    default:
      return new THREE.Matrix4().makeRotationY(HALF_PI);
  }
}

export function isIdentityRotation(m: THREE.Matrix4): boolean {
  const e = m.elements;
  const identity = new THREE.Matrix4().elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(e[i] - identity[i]) > 1e-12) return false;
  }
  return true;
}

function rotatePointArray(array: Float32Array, m: THREE.Matrix4): void {
  const e = m.elements;
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i],
      y = array[i + 1],
      z = array[i + 2];
    array[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    array[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    array[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
}

function rotateDirectionArray(array: Float32Array, m: THREE.Matrix4): void {
  const e = m.elements;
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i],
      y = array[i + 1],
      z = array[i + 2];
    array[i] = e[0] * x + e[4] * y + e[8] * z;
    array[i + 1] = e[1] * x + e[5] * y + e[9] * z;
    array[i + 2] = e[2] * x + e[6] * y + e[10] * z;
  }
}

function rotateVec3(
  v: number[] | undefined,
  m: THREE.Matrix4,
  isPoint: boolean,
): number[] | undefined {
  if (!v || v.length < 3) return v;
  const e = m.elements;
  const t = isPoint ? 1 : 0;
  return [
    e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * t,
    e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * t,
    e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * t,
  ];
}

export function rotateTuple3(
  v: readonly [number, number, number],
  m: THREE.Matrix4,
  isPoint: boolean,
): [number, number, number] {
  const e = m.elements;
  const t = isPoint ? 1 : 0;
  return [
    e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * t,
    e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * t,
    e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * t,
  ];
}

export function rotateInertiaTensor(
  inertia: readonly [number, number, number, number, number, number],
  m: THREE.Matrix4,
): [number, number, number, number, number, number] {
  const e = m.elements;
  const r0x = e[0],
    r0y = e[4],
    r0z = e[8];
  const r1x = e[1],
    r1y = e[5],
    r1z = e[9];
  const r2x = e[2],
    r2y = e[6],
    r2z = e[10];

  const [ixx, ixy, ixz, iyy, iyz, izz] = inertia;

  const dot = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
    ax * (bx * ixx + by * ixy + bz * ixz) +
    ay * (bx * ixy + by * iyy + bz * iyz) +
    az * (bx * ixz + by * iyz + bz * izz);

  return [
    dot(r0x, r0y, r0z, r0x, r0y, r0z),
    dot(r0x, r0y, r0z, r1x, r1y, r1z),
    dot(r0x, r0y, r0z, r2x, r2y, r2z),
    dot(r1x, r1y, r1z, r1x, r1y, r1z),
    dot(r1x, r1y, r1z, r2x, r2y, r2z),
    dot(r2x, r2y, r2z, r2x, r2y, r2z),
  ];
}

export function rotateRPY(
  rpy: readonly [number, number, number],
  m: THREE.Matrix4,
): [number, number, number] {
  const current = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX"),
  );
  const rotation = new THREE.Matrix4().extractRotation(m);
  const combined = new THREE.Matrix4().multiplyMatrices(rotation, current);
  const euler = new THREE.Euler().setFromRotationMatrix(combined, "ZYX");
  return [euler.x, euler.y, euler.z];
}

export function rotateSerializedSolid(data: SerializedSolidData, m: THREE.Matrix4): void {
  rotatePointArray(data.positions, m);
  if (data.normals.length > 0) rotateDirectionArray(data.normals, m);
  if (data.edgePolylines.length > 0) rotatePointArray(data.edgePolylines, m);

  for (const face of data.faceGeometries) {
    face.center = rotateVec3(face.center, m, true);
    face.normal = rotateVec3(face.normal, m, false);
    face.axis = rotateVec3(face.axis, m, false);
  }

  for (const edge of data.edgeGeometries) {
    const start = rotateVec3(edge.startPoint, m, true);
    if (start) edge.startPoint = start;
    const end = rotateVec3(edge.endPoint, m, true);
    if (end) edge.endPoint = end;
    edge.center = rotateVec3(edge.center, m, true);
    edge.axis = rotateVec3(edge.axis, m, false);
  }

  if (data.massProps) {
    data.massProps = {
      volume: data.massProps.volume,
      com: rotateTuple3(data.massProps.com, m, true),
      inertiaAtCom: rotateInertiaTensor(data.massProps.inertiaAtCom, m),
    };
  }
}

export function rotateInertialParams(inertial: InertialParams, m: THREE.Matrix4): InertialParams {
  return {
    mass: inertial.mass,
    com: rotateTuple3(inertial.com, m, true),
    inertia: rotateInertiaTensor(inertial.inertia, m),
  };
}

export interface WorldAlignedJointFrame {
  rpy: [number, number, number];
  axis: [number, number, number];
  childCompensation: THREE.Matrix4;
}

export interface JointFrameTarget {
  id: string;
  parentLinkId: string;
  childLinkId: string;
  origin: { xyz: [number, number, number]; rpy: [number, number, number] };
  axis: [number, number, number];
  axisOffset: [number, number, number];
}

function jointParentRestRotation(
  joints: readonly JointFrameTarget[],
  linkId: string,
): THREE.Matrix4 {
  const incoming = new Map<string, JointFrameTarget>();
  for (const j of joints) incoming.set(j.childLinkId, j);

  const chain: JointFrameTarget[] = [];
  const seen = new Set<string>();
  let cursor = linkId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const j = incoming.get(cursor);
    if (!j) break;
    chain.push(j);
    cursor = j.parentLinkId;
  }

  const m = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i].origin.rpy;
    m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], "ZYX")));
  }
  return m;
}

function topologicalJointOrder(joints: readonly JointFrameTarget[]): JointFrameTarget[] {
  const childIds = new Set(joints.map((j) => j.childLinkId));
  const byParent = new Map<string, JointFrameTarget[]>();
  for (const j of joints) {
    const list = byParent.get(j.parentLinkId) ?? [];
    list.push(j);
    byParent.set(j.parentLinkId, list);
  }

  const queue: string[] = [];
  for (const j of joints) {
    if (!childIds.has(j.parentLinkId) && !queue.includes(j.parentLinkId)) {
      queue.push(j.parentLinkId);
    }
  }

  const ordered: JointFrameTarget[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const linkId = queue.shift()!;
    if (visited.has(linkId)) continue;
    visited.add(linkId);
    for (const j of byParent.get(linkId) ?? []) {
      ordered.push(j);
      queue.push(j.childLinkId);
    }
  }

  for (const j of joints) {
    if (!ordered.includes(j)) ordered.push(j);
  }
  return ordered;
}

export function applyWorldAlignedJointFrame(
  joints: readonly JointFrameTarget[],
  target: JointFrameTarget,
): boolean {
  const aligned = worldAlignJointFrame(
    jointParentRestRotation(joints, target.parentLinkId),
    target.origin.rpy,
    target.axis,
  );
  if (!aligned) return false;

  for (const child of joints) {
    if (child.parentLinkId !== target.childLinkId) continue;
    child.origin = {
      xyz: rotateTuple3(child.origin.xyz, aligned.childCompensation, false),
      rpy: rotateRPY(child.origin.rpy, aligned.childCompensation),
    };
    child.axisOffset = rotateTuple3(child.axisOffset, aligned.childCompensation, false);
  }

  target.origin = { xyz: target.origin.xyz, rpy: aligned.rpy };
  target.axis = aligned.axis;
  return true;
}

export function alignAllJointFramesToWorldZUp(joints: readonly JointFrameTarget[]): number {
  let applied = 0;
  for (const target of topologicalJointOrder(joints)) {
    if (applyWorldAlignedJointFrame(joints, target)) applied++;
  }
  return applied;
}

function worldAlignJointFrame(
  parentRestRotation: THREE.Matrix4,
  rpy: readonly [number, number, number],
  axis: readonly [number, number, number],
): WorldAlignedJointFrame | null {
  if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-9) return null;

  const rParent = new THREE.Matrix4().extractRotation(parentRestRotation);
  const rOld = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX"),
  );
  const rNew = rParent.clone().invert();

  const worldAxis = new THREE.Vector3(axis[0], axis[1], axis[2])
    .normalize()
    .applyMatrix4(rOld)
    .applyMatrix4(rParent)
    .normalize();

  const compensation = new THREE.Matrix4().multiplyMatrices(rOld.clone().invert(), rNew).invert();

  const euler = new THREE.Euler().setFromRotationMatrix(rNew, "ZYX");

  return {
    rpy: [euler.x, euler.y, euler.z],
    axis: [worldAxis.x, worldAxis.y, worldAxis.z],
    childCompensation: compensation,
  };
}
