import type { OcctKernel, ShapeHandle } from "occt-wasm";
import type { FaceGeometryData, EdgeGeometryData } from "../types";

export const HASH_UPPER_BOUND = 2147483647;

const FULL_TURN = Math.PI * 2;
const CLOSED_RATIO = 0.995;
const EPS = 1e-12;

interface P3 {
  x: number;
  y: number;
  z: number;
}

interface CircleFit {
  center: P3;
  axis: P3;
  radius: number;
}

function sub(a: P3, b: P3): P3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: P3, b: P3): P3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function mul(a: P3, s: number): P3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: P3, b: P3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: P3, b: P3): P3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function len(a: P3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function unit(a: P3): P3 | null {
  const l = len(a);
  if (!isFinite(l) || l < EPS) return null;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function tuple(a: P3): number[] {
  return [a.x, a.y, a.z];
}

function finite(a: P3): boolean {
  return isFinite(a.x) && isFinite(a.y) && isFinite(a.z);
}

function fitCircle(A: P3, B: P3, C: P3): CircleFit | null {
  const a = sub(A, C);
  const b = sub(B, C);
  const n = cross(a, b);
  const nn = dot(n, n);
  if (!isFinite(nn) || nn < EPS) return null;

  const aa = dot(a, a);
  const bb = dot(b, b);
  const num = sub(mul(b, aa), mul(a, bb));
  const offset = mul(cross(num, n), 1 / (2 * nn));
  const center = add(C, offset);
  const radius = len(offset);
  const axis = unit(n);

  if (!axis || !finite(center) || !isFinite(radius) || radius < EPS) return null;
  return { center, axis, radius };
}

function samplePoints(kernel: OcctKernel, face: ShapeHandle, us: number[], v: number): P3[] {
  return us.map((u) => kernel.pointOnSurface(face, u, v));
}

function fitFromParamRange(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMin: number,
  uMax: number,
  v: number,
): CircleFit | null {
  const span = uMax - uMin;
  const trials = [
    [uMin, uMin + span / 3, uMin + (2 * span) / 3],
    [uMin, uMin + span / 2, uMax],
    [uMin + span * 0.1, uMin + span * 0.45, uMin + span * 0.8],
  ];
  for (const us of trials) {
    try {
      const [A, B, C] = samplePoints(kernel, face, us, v);
      const fit = fitCircle(A, B, C);
      if (fit) return fit;
    } catch {}
  }
  return null;
}

function planeGeometry(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMid: number,
  vMid: number,
): FaceGeometryData {
  const center = kernel.getSurfaceCenterOfMass(face);
  const normal = kernel.surfaceNormal(face, uMid, vMid);
  const n = unit(normal);
  return {
    type: "plane",
    center: tuple(center),
    normal: n ? tuple(n) : undefined,
  };
}

function cylinderGeometry(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): FaceGeometryData | null {
  const data = kernel.getFaceCylinderData(face);
  if (!data || !isFinite(data.radius) || data.radius < EPS) return null;

  const fit = fitFromParamRange(kernel, face, uMin, uMax, vMin);
  if (!fit) return null;

  const base = kernel.pointOnSurface(face, uMin, vMin);
  const top = kernel.pointOnSurface(face, uMin, vMax);
  const along = sub(top, base);
  const height = len(along);
  const axis = unit(along) ?? fit.axis;

  const uSpan = Math.abs(uMax - uMin);
  return {
    type: uSpan >= FULL_TURN * CLOSED_RATIO ? "cylinder" : "arc",
    center: tuple(fit.center),
    axis: tuple(axis),
    normal: tuple(axis),
    radius: data.radius,
    height: isFinite(height) && height > EPS ? height : undefined,
    uBounds: [uMin, uMax],
    vBounds: [vMin, vMax],
    startAngle: uMin,
    endAngle: uMax,
  };
}

function coneGeometry(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): FaceGeometryData | null {
  const near = fitFromParamRange(kernel, face, uMin, uMax, vMin);
  const far = fitFromParamRange(kernel, face, uMin, uMax, vMax);
  if (!near || !far) return null;

  const along = sub(far.center, near.center);
  const distance = len(along);
  if (!isFinite(distance) || distance < EPS) return null;

  const axis = unit(along);
  if (!axis) return null;

  const semiAngle = Math.atan2(far.radius - near.radius, distance);
  if (!isFinite(semiAngle) || Math.abs(semiAngle) < 1e-9) return null;

  const apex = add(near.center, mul(axis, -near.radius / Math.tan(semiAngle)));
  if (!finite(apex)) return null;

  return {
    type: "cone",
    center: tuple(apex),
    axis: tuple(axis),
    normal: tuple(axis),
    semiAngle,
    radius: near.radius,
    uBounds: [uMin, uMax],
    vBounds: [vMin, vMax],
  };
}

function sphereGeometry(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): FaceGeometryData | null {
  const uMid = (uMin + uMax) / 2;
  const vMid = (vMin + vMax) / 2;
  const curvature = kernel.surfaceCurvature(face, uMid, vMid);
  const magnitude = Math.max(Math.abs(curvature.min), Math.abs(curvature.max));
  if (!isFinite(magnitude) || magnitude < EPS) return null;

  const radius = 1 / magnitude;
  const point = kernel.pointOnSurface(face, uMid, vMid);
  const normal = unit(kernel.surfaceNormal(face, uMid, vMid));
  if (!normal) return null;

  const probeU = uMin + (uMax - uMin) * 0.25;
  const probeV = vMin + (vMax - vMin) * 0.25;
  const probe = kernel.pointOnSurface(face, probeU, probeV);

  const inward = add(point, mul(normal, -radius));
  const outward = add(point, mul(normal, radius));
  const errInward = Math.abs(len(sub(probe, inward)) - radius);
  const errOutward = Math.abs(len(sub(probe, outward)) - radius);
  const center = errInward <= errOutward ? inward : outward;
  if (!finite(center)) return null;

  return {
    type: "sphere",
    center: tuple(center),
    radius,
    uBounds: [uMin, uMax],
    vBounds: [vMin, vMax],
  };
}

function torusGeometry(
  kernel: OcctKernel,
  face: ShapeHandle,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): FaceGeometryData | null {
  const majorFit = fitFromParamRange(kernel, face, uMin, uMax, vMin);
  if (!majorFit) return null;

  const uMid = (uMin + uMax) / 2;
  const vSpan = vMax - vMin;
  let tubeFit: CircleFit | null = null;
  for (const vs of [
    [vMin, vMin + vSpan / 3, vMin + (2 * vSpan) / 3],
    [vMin, vMin + vSpan / 2, vMax],
  ]) {
    try {
      const pts = vs.map((v) => kernel.pointOnSurface(face, uMid, v));
      tubeFit = fitCircle(pts[0], pts[1], pts[2]);
      if (tubeFit) break;
    } catch {}
  }
  if (!tubeFit) return null;

  const axis = majorFit.axis;
  const offset = sub(tubeFit.center, majorFit.center);
  const center = add(majorFit.center, mul(axis, dot(offset, axis)));
  const majorRadius = len(sub(tubeFit.center, center));
  const minorRadius = tubeFit.radius;
  if (!isFinite(majorRadius) || majorRadius < EPS) return null;

  return {
    type: "torus",
    center: tuple(center),
    axis: tuple(axis),
    normal: tuple(axis),
    majorRadius,
    minorRadius,
    radius: majorRadius,
    uBounds: [uMin, uMax],
    vBounds: [vMin, vMax],
  };
}

export function extractFaceGeometry(kernel: OcctKernel, face: ShapeHandle): FaceGeometryData {
  try {
    const kind = kernel.surfaceType(face);
    const bounds = kernel.uvBounds(face);
    const { uMin, uMax, vMin, vMax } = bounds;
    if (![uMin, uMax, vMin, vMax].every(isFinite)) return { type: "face" };

    const uMid = (uMin + uMax) / 2;
    const vMid = (vMin + vMax) / 2;

    switch (kind) {
      case "plane":
        return planeGeometry(kernel, face, uMid, vMid);
      case "cylinder":
        return cylinderGeometry(kernel, face, uMin, uMax, vMin, vMax) ?? { type: "face" };
      case "cone":
        return coneGeometry(kernel, face, uMin, uMax, vMin, vMax) ?? { type: "face" };
      case "sphere":
        return sphereGeometry(kernel, face, uMin, uMax, vMin, vMax) ?? { type: "face" };
      case "torus":
        return torusGeometry(kernel, face, uMin, uMax, vMin, vMax) ?? { type: "face" };
      default:
        return { type: "face" };
    }
  } catch {
    return { type: "face" };
  }
}

const CURVE_KIND_MAP: Record<string, string> = {
  line: "line",
  circle: "circle",
  ellipse: "ellipse",
  bspline: "bspline",
  bezier: "bezier",
};

export function extractEdgeGeometry(kernel: OcctKernel, edge: ShapeHandle): EdgeGeometryData {
  let curveType = "other";
  let startPoint = [0, 0, 0];
  let endPoint = [0, 0, 0];
  let length = 0;
  let radius: number | undefined;
  let center: number[] | undefined;
  let axis: number[] | undefined;
  let first = 0;
  let last = 0;

  try {
    curveType = CURVE_KIND_MAP[kernel.curveType(edge)] ?? "other";
  } catch {}

  try {
    const params = kernel.curveParameters(edge);
    first = params.first;
    last = params.last;
    startPoint = tuple(kernel.curvePointAtParam(edge, first));
    endPoint = tuple(kernel.curvePointAtParam(edge, last));
  } catch {}

  try {
    length = kernel.curveLength(edge);
  } catch {
    length = Math.hypot(
      endPoint[0] - startPoint[0],
      endPoint[1] - startPoint[1],
      endPoint[2] - startPoint[2],
    );
  }

  if (curveType === "circle") {
    const span = last - first;
    for (const ts of [
      [0, 1 / 3, 2 / 3],
      [0, 0.5, 1],
      [0.1, 0.45, 0.8],
    ]) {
      try {
        const pts = ts.map((t) => kernel.curvePointAtParam(edge, first + span * t));
        const fit = fitCircle(pts[0], pts[1], pts[2]);
        if (fit) {
          radius = fit.radius;
          center = tuple(fit.center);
          axis = tuple(fit.axis);
          break;
        }
      } catch {}
    }
  }

  return {
    curveType,
    length: isFinite(length) ? length : 0,
    startPoint,
    endPoint,
    radius,
    center,
    axis,
    startAngle: first,
    endAngle: last,
  };
}
