import * as THREE from "three";

export interface AxisFrame {
  x: [number, number, number];
  y: [number, number, number];
  z: [number, number, number];
}

export type FrameAxis = "x" | "y" | "z";

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function negate(v: [number, number, number]): [number, number, number] {
  return [-v[0], -v[1], -v[2]];
}

export function buildAxisFrame(normal: [number, number, number]): AxisFrame {
  const z = normalize(normal);

  const absX = Math.abs(z[0]);
  const absY = Math.abs(z[1]);
  const absZ = Math.abs(z[2]);
  const ref: [number, number, number] =
    absX < absY && absX < absZ ? [1, 0, 0] : absY < absZ ? [0, 1, 0] : [0, 0, 1];

  const x = normalize(cross(ref, z));
  const y = cross(z, x);
  return { x, y, z };
}

export function flipAxisFrame(frame: AxisFrame, axis: FrameAxis): AxisFrame {
  switch (axis) {
    case "x":
      return { x: negate(frame.x), y: negate(frame.y), z: frame.z };
    case "y":
      return { x: frame.x, y: negate(frame.y), z: negate(frame.z) };
    case "z":
    default:
      return { x: negate(frame.x), y: frame.y, z: negate(frame.z) };
  }
}

export function frameToArray(
  frame: AxisFrame,
): [number, number, number, number, number, number, number, number, number] {
  return [
    frame.x[0],
    frame.x[1],
    frame.x[2],
    frame.y[0],
    frame.y[1],
    frame.y[2],
    frame.z[0],
    frame.z[1],
    frame.z[2],
  ];
}

export function flipRPY(
  rpy: readonly [number, number, number],
  axis: FrameAxis,
): [number, number, number] {
  const R = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX"),
  );
  const half = Math.PI;
  const local =
    axis === "z"
      ? new THREE.Matrix4().makeRotationY(half)
      : axis === "x"
        ? new THREE.Matrix4().makeRotationZ(half)
        : new THREE.Matrix4().makeRotationX(half);

  R.multiply(local);

  const e = new THREE.Euler().setFromRotationMatrix(R, "ZYX");
  return [e.x, e.y, e.z];
}
