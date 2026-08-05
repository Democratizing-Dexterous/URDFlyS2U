import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import type {
  CollisionShape,
  CollisionShapeType,
  CollisionMode,
  CollisionConflict,
  CollisionBuildResult,
} from "../types";
import { meshVolume as computeMeshVolume } from "./MeshSplitter";

const MAX_SCAN_POINTS = 200000;
const EPS = 1e-9;

export interface SolidGeometryInput {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface LinkGeometryInput {
  linkId: string;
  solids: SolidGeometryInput[];
  preferredAxes: [number, number, number][];
  mode: CollisionMode;
}

export interface SeparateOptions {
  margin: number;
  minScale: number;
  maxIterations?: number;
  deltaConfigs?: Map<string, THREE.Matrix4>[];
  adjacentPairs?: Iterable<readonly [string, string]>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function fitLinkShape(input: LinkGeometryInput): CollisionShape | null {
  const merged = mergeSolids(input.solids);
  if (!merged || merged.pts.length < 9) return null;

  const meshVolume = merged.volume;
  const box = fitBox(merged.pts, merged.normals);
  if (!box) return null;

  const axes: number[][] = [
    [box.rot[0], box.rot[1], box.rot[2]],
    [box.rot[3], box.rot[4], box.rot[5]],
    [box.rot[6], box.rot[7], box.rot[8]],
  ];
  for (const a of input.preferredAxes) {
    const len = Math.hypot(a[0], a[1], a[2]);
    if (len > EPS) axes.push([a[0] / len, a[1] / len, a[2] / len]);
  }
  axes.push(...merged.normals);

  const cylinder = fitCylinder(merged.pts, axes);
  const sphere = fitSphere(merged.pts);

  let type: CollisionShapeType = input.mode === "auto" ? "box" : input.mode;

  if (input.mode === "auto") {
    const scored: { type: CollisionShapeType; cost: number }[] = [
      { type: "box", cost: box.volume * 0.92 },
      { type: "cylinder", cost: cylinder.volume },
      { type: "sphere", cost: sphere.volume * 1.05 },
    ];
    scored.sort((a, b) => a.cost - b.cost);
    type = scored[0].type;
  }

  const shape = assembleShape(input.linkId, type, box, cylinder, sphere, merged.pts, meshVolume);
  return shape;
}

export function separateShapes(
  shapes: CollisionShape[],
  options: SeparateOptions,
): CollisionBuildResult {
  const margin = Math.max(options.margin, 0);
  const minScale = Math.min(Math.max(options.minScale, 0.05), 1);
  const maxIterations = options.maxIterations ?? 12;
  const configs =
    options.deltaConfigs && options.deltaConfigs.length > 0
      ? options.deltaConfigs
      : [new Map<string, THREE.Matrix4>()];
  const adjacent = new Set<string>();
  for (const [a, b] of options.adjacentPairs ?? []) adjacent.add(pairKey(a, b));

  let conflicts: CollisionConflict[] = [];
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    conflicts = [];
    let resolvedAny = false;

    for (const config of configs) {
      const proxies = shapes.map((s) => makeProxy(s, config.get(s.linkId)));

      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          if (adjacent.has(pairKey(shapes[i].linkId, shapes[j].linkId))) continue;
          if (sameDelta(config.get(shapes[i].linkId), config.get(shapes[j].linkId))) {
            if (config !== configs[0]) continue;
          }
          const hit = testOBB(proxies[i], proxies[j], margin);
          if (!hit) continue;

          conflicts.push({
            linkAId: shapes[i].linkId,
            linkBId: shapes[j].linkId,
            depth: hit.depth,
          });

          const half = hit.depth / 2;
          const okA = shrinkShape(
            shapes[i],
            hit.axis,
            half,
            config.get(shapes[i].linkId),
            minScale,
            1,
          );
          const okB = shrinkShape(
            shapes[j],
            hit.axis,
            half,
            config.get(shapes[j].linkId),
            minScale,
            -1,
          );
          if (okA || okB) resolvedAny = true;
        }
      }
    }

    if (conflicts.length === 0) break;
    if (!resolvedAny) break;
  }

  return { shapes, conflicts, iterations };
}

export function shapeLocalMatrix(shape: CollisionShape): THREE.Matrix4 {
  const q = new THREE.Quaternion(shape.quat[0], shape.quat[1], shape.quat[2], shape.quat[3]);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(shape.center[0], shape.center[1], shape.center[2]);
  return m;
}

function assembleShape(
  linkId: string,
  type: CollisionShapeType,
  box: BoxFit,
  cylinder: CylinderFit,
  sphere: SphereFit,
  pts: Float64Array,
  meshVolume: number,
): CollisionShape {
  const boxQuat = quatFromRot(box.rot);

  if (type === "box") {
    return {
      linkId,
      type,
      center: [box.center[0], box.center[1], box.center[2]],
      quat: boxQuat,
      halfExtents: [box.half[0], box.half[1], box.half[2]],
      originalHalfExtents: [box.half[0], box.half[1], box.half[2]],
      radius: 0,
      height: 0,
      meshVolume,
      shapeVolume: box.volume,
      shrunk: false,
    };
  }

  if (type === "cylinder") {
    const q = quatFromZAxis(cylinder.axis);
    const half: [number, number, number] = [cylinder.radius, cylinder.radius, cylinder.height / 2];
    return {
      linkId,
      type,
      center: [cylinder.center[0], cylinder.center[1], cylinder.center[2]],
      quat: q,
      halfExtents: half,
      originalHalfExtents: [...half] as [number, number, number],
      radius: cylinder.radius,
      height: cylinder.height,
      meshVolume,
      shapeVolume: cylinder.volume,
      shrunk: false,
    };
  }

  if (type === "sphere") {
    const half: [number, number, number] = [sphere.radius, sphere.radius, sphere.radius];
    return {
      linkId,
      type,
      center: [sphere.center[0], sphere.center[1], sphere.center[2]],
      quat: [0, 0, 0, 1],
      halfExtents: half,
      originalHalfExtents: [...half] as [number, number, number],
      radius: sphere.radius,
      height: 0,
      meshVolume,
      shapeVolume: sphere.volume,
      shrunk: false,
    };
  }

  return {
    linkId,
    type: "box",
    center: [box.center[0], box.center[1], box.center[2]],
    quat: boxQuat,
    halfExtents: [box.half[0], box.half[1], box.half[2]],
    originalHalfExtents: [box.half[0], box.half[1], box.half[2]],
    radius: 0,
    height: 0,
    meshVolume,
    shapeVolume: box.volume,
    shrunk: false,
  };
}

interface MergedGeometry {
  pts: Float64Array;
  normals: number[][];
  volume: number;
}

function convexHullOf(points: THREE.Vector3[]): ConvexHull | null {
  if (points.length < 4) return null;
  try {
    const hull = new ConvexHull().setFromPoints(points);
    return hull.faces.length > 0 ? hull : null;
  } catch {
    return null;
  }
}

function mergeSolids(solids: SolidGeometryInput[]): MergedGeometry | null {
  let totalPoints = 0;
  let volume = 0;
  for (const s of solids) {
    totalPoints += s.positions.length / 3;
    volume += Math.abs(computeMeshVolume(s.positions, s.indices));
  }
  if (totalPoints === 0) return null;

  const stride = Math.max(1, Math.ceil(totalPoints / MAX_SCAN_POINTS));
  const input: THREE.Vector3[] = [];
  for (const s of solids) {
    const p = s.positions;
    const n = p.length / 3;
    for (let i = 0; i < n; i += stride) {
      input.push(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    }
  }

  const hull = convexHullOf(input);
  if (!hull) {
    const flat = new Float64Array(input.length * 3);
    input.forEach((v, i) => {
      flat[i * 3] = v.x;
      flat[i * 3 + 1] = v.y;
      flat[i * 3 + 2] = v.z;
    });
    return { pts: flat, normals: [], volume: Math.abs(volume) };
  }

  const seen = new Set<THREE.Vector3>();
  const pts: number[] = [];
  const normals: number[][] = [];
  const normalSeen = new Set<string>();

  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      const point = edge.head().point;
      if (!seen.has(point)) {
        seen.add(point);
        pts.push(point.x, point.y, point.z);
      }
      edge = edge.next;
    } while (edge !== face.edge);

    const n = face.normal;
    const key = `${n.x.toFixed(6)}_${n.y.toFixed(6)}_${n.z.toFixed(6)}`;
    if (!normalSeen.has(key)) {
      normalSeen.add(key);
      normals.push([n.x, n.y, n.z]);
    }
  }

  return { pts: Float64Array.from(pts), normals, volume: Math.abs(volume) };
}

interface BoxFit {
  center: number[];
  half: number[];
  rot: number[];
  volume: number;
}

interface CylinderFit {
  center: number[];
  axis: number[];
  radius: number;
  height: number;
  volume: number;
}

interface SphereFit {
  center: number[];
  radius: number;
  volume: number;
}

function projectHull(pts: Float64Array, u: number[], v: number[]): Float64Array {
  const n = pts.length / 3;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const z = pts[i * 3 + 2];
    out[i * 2] = u[0] * x + u[1] * y + u[2] * z;
    out[i * 2 + 1] = v[0] * x + v[1] * y + v[2] * z;
  }
  return out;
}

function convexHull2D(pts: Float64Array): Float64Array {
  const n = pts.length / 2;
  if (n < 3) return pts;

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const dx = pts[a * 2] - pts[b * 2];
    return dx !== 0 ? dx : pts[a * 2 + 1] - pts[b * 2 + 1];
  });

  const cross = (o: number, a: number, b: number): number =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);

  const build = (seq: number[]): number[] => {
    const stack: number[] = [];
    for (const i of seq) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], i) <= 0) {
        stack.pop();
      }
      stack.push(i);
    }
    stack.pop();
    return stack;
  };

  const chain = [...build(order), ...build(order.slice().reverse())];
  const out = new Float64Array(chain.length * 2);
  chain.forEach((idx, i) => {
    out[i * 2] = pts[idx * 2];
    out[i * 2 + 1] = pts[idx * 2 + 1];
  });
  return out;
}

interface Rect2D {
  area: number;
  axis: [number, number];
  halfU: number;
  halfV: number;
  midU: number;
  midV: number;
}

function minAreaRect(hull2d: Float64Array): Rect2D {
  const n = hull2d.length / 2;
  let best: Rect2D | null = null;

  const evaluate = (dx: number, dy: number): void => {
    const len = Math.hypot(dx, dy);
    if (len < EPS) return;
    const ax = dx / len;
    const ay = dy / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = hull2d[i * 2];
      const y = hull2d[i * 2 + 1];
      const u = ax * x + ay * y;
      const v = -ay * x + ax * y;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const halfU = Math.max((maxU - minU) / 2, EPS);
    const halfV = Math.max((maxV - minV) / 2, EPS);
    const area = halfU * halfV * 4;
    if (!best || area < best.area - EPS) {
      best = {
        area,
        axis: [ax, ay],
        halfU,
        halfV,
        midU: (maxU + minU) / 2,
        midV: (maxV + minV) / 2,
      };
    }
  };

  if (n < 2) {
    evaluate(1, 0);
    return best!;
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    evaluate(hull2d[j * 2] - hull2d[i * 2], hull2d[j * 2 + 1] - hull2d[i * 2 + 1]);
  }
  return best!;
}

function boxFromAxes(pts: Float64Array, rot: number[]): BoxFit {
  const n = pts.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < n; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const z = pts[i * 3 + 2];
    for (let a = 0; a < 3; a++) {
      const d = rot[a * 3] * x + rot[a * 3 + 1] * y + rot[a * 3 + 2] * z;
      if (d < min[a]) min[a] = d;
      if (d > max[a]) max[a] = d;
    }
  }

  const half = [
    Math.max((max[0] - min[0]) / 2, EPS),
    Math.max((max[1] - min[1]) / 2, EPS),
    Math.max((max[2] - min[2]) / 2, EPS),
  ];
  const mid = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
  const center = [
    rot[0] * mid[0] + rot[3] * mid[1] + rot[6] * mid[2],
    rot[1] * mid[0] + rot[4] * mid[1] + rot[7] * mid[2],
    rot[2] * mid[0] + rot[5] * mid[1] + rot[8] * mid[2],
  ];

  return { center, half, rot, volume: 8 * half[0] * half[1] * half[2] };
}

function fitBox(pts: Float64Array, hullNormals: number[][]): BoxFit | null {
  const n = pts.length / 3;
  if (n === 0) return null;

  const candidates: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], ...hullNormals];

  let best: BoxFit | null = null;
  for (const axis of candidates) {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < EPS) continue;
    const w = [axis[0] / len, axis[1] / len, axis[2] / len];
    const [u, v] = orthoBasis(w);

    const rect = minAreaRect(convexHull2D(projectHull(pts, u, v)));
    const c = rect.axis[0];
    const s = rect.axis[1];
    const e0 = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
    const e1 = [-u[0] * s + v[0] * c, -u[1] * s + v[1] * c, -u[2] * s + v[2] * c];

    const fit = boxFromAxes(pts, [e0[0], e0[1], e0[2], e1[0], e1[1], e1[2], w[0], w[1], w[2]]);
    if (!best || fit.volume < best.volume - EPS) best = fit;
  }

  return best;
}

function welzlCircle(proj: Float64Array): { x: number; y: number; r: number } {
  const n = proj.length / 2;
  if (n === 0) return { x: 0, y: 0, r: EPS };

  const px = (i: number) => proj[i * 2];
  const py = (i: number) => proj[i * 2 + 1];

  const fromTwo = (a: number, b: number) => ({
    x: (px(a) + px(b)) / 2,
    y: (py(a) + py(b)) / 2,
    r: Math.hypot(px(a) - px(b), py(a) - py(b)) / 2,
  });

  const fromThree = (a: number, b: number, c: number) => {
    const ax = px(a);
    const ay = py(a);
    const bx = px(b) - ax;
    const by = py(b) - ay;
    const cx = px(c) - ax;
    const cy = py(c) - ay;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < EPS) return null;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (cy * b2 - by * c2) / d;
    const uy = (bx * c2 - cx * b2) / d;
    return { x: ax + ux, y: ay + uy, r: Math.hypot(ux, uy) };
  };

  const inside = (circle: { x: number; y: number; r: number }, i: number): boolean =>
    Math.hypot(px(i) - circle.x, py(i) - circle.y) <= circle.r * (1 + 1e-12) + EPS;

  let circle = { x: px(0), y: py(0), r: 0 };
  for (let i = 1; i < n; i++) {
    if (inside(circle, i)) continue;
    circle = { x: px(i), y: py(i), r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(circle, j)) continue;
      circle = fromTwo(i, j);
      for (let k = 0; k < j; k++) {
        if (inside(circle, k)) continue;
        const c3 = fromThree(i, j, k);
        if (c3) circle = c3;
      }
    }
  }

  circle.r = Math.max(circle.r, EPS);
  return circle;
}

function fitCylinder(pts: Float64Array, axes: number[][]): CylinderFit {
  let best: CylinderFit | null = null;

  for (const axis of axes) {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < EPS) continue;
    const w = [axis[0] / len, axis[1] / len, axis[2] / len];
    const [u, v] = orthoBasis(w);
    const n = pts.length / 3;

    let minA = Infinity;
    let maxA = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = w[0] * pts[i * 3] + w[1] * pts[i * 3 + 1] + w[2] * pts[i * 3 + 2];
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
    }

    const circle = welzlCircle(projectHull(pts, u, v));
    const height = Math.max(maxA - minA, EPS);
    const radius = Math.max(circle.r, EPS);
    const midA = (maxA + minA) / 2;
    const center = [
      w[0] * midA + u[0] * circle.x + v[0] * circle.y,
      w[1] * midA + u[1] * circle.x + v[1] * circle.y,
      w[2] * midA + u[2] * circle.x + v[2] * circle.y,
    ];
    const volume = Math.PI * radius * radius * height;
    if (!best || volume < best.volume - EPS) {
      best = { center, axis: w, radius, height, volume };
    }
  }

  return best!;
}

function fitSphere(pts: Float64Array): SphereFit {
  const n = pts.length / 3;
  if (n === 0) return { center: [0, 0, 0], radius: EPS, volume: 0 };

  const px = (i: number) => pts[i * 3];
  const py = (i: number) => pts[i * 3 + 1];
  const pz = (i: number) => pts[i * 3 + 2];

  const inside = (c: { x: number; y: number; z: number; r: number }, i: number): boolean =>
    Math.hypot(px(i) - c.x, py(i) - c.y, pz(i) - c.z) <= c.r * (1 + 1e-12) + EPS;

  const fromTwo = (a: number, b: number) => ({
    x: (px(a) + px(b)) / 2,
    y: (py(a) + py(b)) / 2,
    z: (pz(a) + pz(b)) / 2,
    r: Math.hypot(px(a) - px(b), py(a) - py(b), pz(a) - pz(b)) / 2,
  });

  const grow = (c: { x: number; y: number; z: number; r: number }, i: number) => {
    const d = Math.hypot(px(i) - c.x, py(i) - c.y, pz(i) - c.z);
    if (d <= c.r) return c;
    const r = (c.r + d) / 2;
    const k = (r - c.r) / d;
    return {
      x: c.x + (px(i) - c.x) * k,
      y: c.y + (py(i) - c.y) * k,
      z: c.z + (pz(i) - c.z) * k,
      r,
    };
  };

  let sphere = { x: px(0), y: py(0), z: pz(0), r: 0 };
  for (let i = 1; i < n; i++) {
    if (inside(sphere, i)) continue;
    sphere = { x: px(i), y: py(i), z: pz(i), r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(sphere, j)) continue;
      sphere = fromTwo(i, j);
      for (let k = 0; k < j; k++) {
        if (inside(sphere, k)) continue;
        sphere = grow(sphere, k);
      }
    }
  }

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (inside(sphere, i)) continue;
      sphere = grow(sphere, i);
      changed = true;
    }
    if (!changed) break;
  }

  const r = Math.max(sphere.r, EPS);
  return {
    center: [sphere.x, sphere.y, sphere.z],
    radius: r,
    volume: (4 / 3) * Math.PI * r * r * r,
  };
}

interface Proxy {
  center: THREE.Vector3;
  axes: THREE.Vector3[];
  half: number[];
}

function makeProxy(shape: CollisionShape, delta?: THREE.Matrix4): Proxy {
  const m = shapeLocalMatrix(shape);
  if (delta) m.premultiply(delta);

  const center = new THREE.Vector3().setFromMatrixPosition(m);
  const e = m.elements;
  const axes = [
    new THREE.Vector3(e[0], e[1], e[2]).normalize(),
    new THREE.Vector3(e[4], e[5], e[6]).normalize(),
    new THREE.Vector3(e[8], e[9], e[10]).normalize(),
  ];
  return { center, axes, half: [...shape.halfExtents] };
}

function testOBB(
  a: Proxy,
  b: Proxy,
  margin: number,
): { axis: THREE.Vector3; depth: number } | null {
  const t = new THREE.Vector3().subVectors(b.center, a.center);
  const candidates: THREE.Vector3[] = [];

  for (let i = 0; i < 3; i++) candidates.push(a.axes[i].clone());
  for (let i = 0; i < 3; i++) candidates.push(b.axes[i].clone());
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const c = new THREE.Vector3().crossVectors(a.axes[i], b.axes[j]);
      if (c.lengthSq() > 1e-12) candidates.push(c.normalize());
    }
  }

  let bestGap = -Infinity;
  let bestAxis: THREE.Vector3 | null = null;
  const scale = Math.max(...a.half, ...b.half, 1);
  const tol = 1e-6 * scale;

  for (const axis of candidates) {
    const rA =
      a.half[0] * Math.abs(axis.dot(a.axes[0])) +
      a.half[1] * Math.abs(axis.dot(a.axes[1])) +
      a.half[2] * Math.abs(axis.dot(a.axes[2]));
    const rB =
      b.half[0] * Math.abs(axis.dot(b.axes[0])) +
      b.half[1] * Math.abs(axis.dot(b.axes[1])) +
      b.half[2] * Math.abs(axis.dot(b.axes[2]));
    const d = t.dot(axis);
    const gap = Math.abs(d) - rA - rB;

    if (gap >= margin - tol) return null;
    if (gap > bestGap) {
      bestGap = gap;
      bestAxis = d < 0 ? axis.clone().negate() : axis.clone();
    }
  }

  if (!bestAxis) return null;
  return { axis: bestAxis, depth: margin - bestGap };
}

function shrinkShape(
  shape: CollisionShape,
  worldAxis: THREE.Vector3,
  amount: number,
  delta: THREE.Matrix4 | undefined,
  minScale: number,
  sign: number,
): boolean {
  if (amount <= EPS) return false;

  const dir = worldAxis.clone().multiplyScalar(sign);
  if (delta) {
    const rot = new THREE.Matrix4().extractRotation(delta).transpose();
    dir.applyMatrix4(rot).normalize();
  }

  const q = new THREE.Quaternion(shape.quat[0], shape.quat[1], shape.quat[2], shape.quat[3]);
  const inv = q.clone().invert();
  const local = dir.clone().applyQuaternion(inv);

  if (shape.type === "sphere") {
    const limit = shape.originalHalfExtents[0] * minScale;
    const cut = Math.min(amount / 2, Math.max(shape.radius - limit, 0));
    if (cut <= EPS) return false;
    shape.radius -= cut;
    shape.halfExtents = [shape.radius, shape.radius, shape.radius];
    shape.center = offsetCenter(shape.center, dir, -cut);
    shape.shapeVolume = (4 / 3) * Math.PI * Math.pow(shape.radius, 3);
    shape.shrunk = true;
    return true;
  }

  if (shape.type === "cylinder") {
    const axial = Math.abs(local.z) * (shape.height / 2);
    const radial = Math.hypot(local.x, local.y) * shape.radius;
    const alongAxis = axial >= radial;
    if (alongAxis) {
      const limit = shape.originalHalfExtents[2] * 2 * minScale;
      const cut = Math.min(amount, Math.max(shape.height - limit, 0));
      if (cut <= EPS) return false;
      shape.height -= cut;
      shape.halfExtents = [shape.radius, shape.radius, shape.height / 2];
      const zWorld = new THREE.Vector3(0, 0, Math.sign(local.z) || 1).applyQuaternion(q);
      shape.center = offsetCenter(shape.center, zWorld, -cut / 2);
    } else {
      const limit = shape.originalHalfExtents[0] * minScale;
      const cut = Math.min(amount / 2, Math.max(shape.radius - limit, 0));
      if (cut <= EPS) return false;
      shape.radius -= cut;
      shape.halfExtents = [shape.radius, shape.radius, shape.halfExtents[2]];
      shape.center = offsetCenter(shape.center, dir, -cut);
    }
    shape.shapeVolume = Math.PI * shape.radius * shape.radius * shape.height;
    shape.shrunk = true;
    return true;
  }

  const comps = [
    Math.abs(local.x) * shape.halfExtents[0],
    Math.abs(local.y) * shape.halfExtents[1],
    Math.abs(local.z) * shape.halfExtents[2],
  ];
  let k = 0;
  if (comps[1] > comps[k]) k = 1;
  if (comps[2] > comps[k]) k = 2;
  const s = Math.sign([local.x, local.y, local.z][k]) || 1;

  const limit = shape.originalHalfExtents[k] * minScale;
  const cut = Math.min(amount, Math.max(shape.halfExtents[k] * 2 - limit * 2, 0));
  if (cut <= EPS) return false;

  const half = [...shape.halfExtents] as [number, number, number];
  half[k] -= cut / 2;
  shape.halfExtents = half;

  const axisLocal = new THREE.Vector3(k === 0 ? s : 0, k === 1 ? s : 0, k === 2 ? s : 0);
  const axisWorld = axisLocal.applyQuaternion(q);
  shape.center = offsetCenter(shape.center, axisWorld, -cut / 2);

  shape.shapeVolume = 8 * half[0] * half[1] * half[2];
  shape.shrunk = true;
  return true;
}

function offsetCenter(
  center: [number, number, number],
  dir: THREE.Vector3,
  distance: number,
): [number, number, number] {
  return [center[0] + dir.x * distance, center[1] + dir.y * distance, center[2] + dir.z * distance];
}

function sameDelta(a?: THREE.Matrix4, b?: THREE.Matrix4): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.elements[i] - b.elements[i]) > 1e-9) return false;
  }
  return true;
}

function quatFromRot(rot: number[]): [number, number, number, number] {
  const m = new THREE.Matrix4().set(
    rot[0],
    rot[3],
    rot[6],
    0,
    rot[1],
    rot[4],
    rot[7],
    0,
    rot[2],
    rot[5],
    rot[8],
    0,
    0,
    0,
    0,
    1,
  );
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

function quatFromZAxis(axis: number[]): [number, number, number, number] {
  const z = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), z);
  return [q.x, q.y, q.z, q.w];
}

function orthoBasis(axis: number[]): [number[], number[]] {
  const n = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return [
    [u.x, u.y, u.z],
    [v.x, v.y, v.z],
  ];
}
