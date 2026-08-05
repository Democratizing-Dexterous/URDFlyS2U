import type {
  SerializedSolidData,
  FaceGroupInfo,
  FaceGeometryData,
  EdgeGroupInfo,
  EdgeGeometryData,
  SerializedTreeNode,
  SolidMassProps,
  TreeNodeType,
} from "../types";
import type { RawMesh } from "./StlParser";

export interface SplitOptions {
  weldTolerance?: number;
  minTriangles?: number;
  maxFaceGroups?: number;
  separateTouching?: boolean;
}

export interface MeshComponent {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  volume: number;
}

const DEFAULT_MAX_FACE_GROUPS = 4000;

export function defaultWeldTolerance(positions: Float32Array): number {
  const b = bounds(positions);
  if (!b) return 1e-4;
  const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  return Math.max(diag * 1e-6, 1e-5);
}

function bounds(positions: Float32Array): Float64Array | null {
  if (positions.length < 3) return null;
  const b = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < b[k]) b[k] = v;
      if (v > b[k + 3]) b[k + 3] = v;
    }
  }
  return isFinite(b[0]) ? b : null;
}

class VertexGrid {
  private readonly mask: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  private readonly coords: Float32Array;
  private readonly cell: number;
  private readonly toleranceSq: number;
  private count = 0;

  constructor(capacity: number, cellSize: number) {
    const slots = Math.max(16, 1 << (32 - Math.clz32(Math.max(1, capacity - 1))));
    this.mask = slots - 1;
    this.heads = new Int32Array(slots).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.coords = new Float32Array(capacity * 3);
    this.cell = cellSize > 0 ? cellSize : 1e-6;
    this.toleranceSq = this.cell * this.cell;
  }

  private bucket(cx: number, cy: number, cz: number): number {
    return (
      (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & this.mask
    );
  }

  find(x: number, y: number, z: number): number {
    const cx = Math.round(x / this.cell);
    const cy = Math.round(y / this.cell);
    const cz = Math.round(z / this.cell);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          let id = this.heads[this.bucket(cx + ox, cy + oy, cz + oz)];
          while (id >= 0) {
            const dx = this.coords[id * 3] - x;
            const dy = this.coords[id * 3 + 1] - y;
            const dz = this.coords[id * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= this.toleranceSq) return id;
            id = this.next[id];
          }
        }
      }
    }
    return -1;
  }

  add(x: number, y: number, z: number): number {
    const id = this.count++;
    this.coords[id * 3] = x;
    this.coords[id * 3 + 1] = y;
    this.coords[id * 3 + 2] = z;
    const key = this.bucket(
      Math.round(x / this.cell),
      Math.round(y / this.cell),
      Math.round(z / this.cell),
    );
    this.next[id] = this.heads[key];
    this.heads[key] = id;
    return id;
  }

  get size(): number {
    return this.count;
  }
}

export function weldVertices(
  positions: Float32Array,
  tolerance: number,
): { weldMap: Uint32Array; weldedCount: number } {
  const vertexCount = positions.length / 3;
  const weldMap = new Uint32Array(vertexCount);
  const grid = new VertexGrid(vertexCount, tolerance);

  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const hit = grid.find(x, y, z);
    weldMap[v] = hit >= 0 ? hit : grid.add(x, y, z);
  }

  return { weldMap, weldedCount: grid.size };
}

function findRoot(parent: Uint32Array, index: number): number {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  let cursor = index;
  while (parent[cursor] !== root) {
    const next = parent[cursor];
    parent[cursor] = root;
    cursor = next;
  }
  return root;
}

function union(parent: Uint32Array, a: number, b: number): void {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

function linkTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  weldMap: Uint32Array,
  weldedCount: number,
  separateTouching: boolean,
): Uint32Array {
  const triangleCount = Math.floor(indices.length / 3);
  const parent = new Uint32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) parent[t] = t;

  const halfEdges = triangleCount * 3;
  const keys = new Float64Array(halfEdges);
  for (let h = 0; h < halfEdges; h++) {
    const t = (h / 3) | 0;
    const c = h - t * 3;
    const a = weldMap[indices[t * 3 + c]];
    const b = weldMap[indices[t * 3 + ((c + 1) % 3)]];
    keys[h] = a < b ? a * weldedCount + b : b * weldedCount + a;
  }

  const order = new Uint32Array(halfEdges);
  for (let h = 0; h < halfEdges; h++) order[h] = h;
  order.sort((x, y) => keys[x] - keys[y]);

  let start = 0;
  while (start < halfEdges) {
    let end = start + 1;
    while (end < halfEdges && keys[order[end]] === keys[order[start]]) end++;

    const span = end - start;
    if (span === 2) {
      union(parent, (order[start] / 3) | 0, (order[start + 1] / 3) | 0);
    } else if (span > 2) {
      if (separateTouching) {
        pairRadially(positions, indices, weldMap, order, start, end, parent);
      } else {
        for (let i = start + 1; i < end; i++) {
          union(parent, (order[start] / 3) | 0, (order[i] / 3) | 0);
        }
      }
    }
    start = end;
  }

  return parent;
}

function pairRadially(
  positions: Float32Array,
  indices: Uint32Array,
  weldMap: Uint32Array,
  order: Uint32Array,
  start: number,
  end: number,
  parent: Uint32Array,
): void {
  const span = end - start;
  const first = order[start];
  const ft = (first / 3) | 0;
  const fc = first - ft * 3;
  const v0 = indices[ft * 3 + fc];
  const v1 = indices[ft * 3 + ((fc + 1) % 3)];
  const originId = weldMap[v0];

  const ax = positions[v0 * 3];
  const ay = positions[v0 * 3 + 1];
  const az = positions[v0 * 3 + 2];
  let dx = positions[v1 * 3] - ax;
  let dy = positions[v1 * 3 + 1] - ay;
  let dz = positions[v1 * 3 + 2] - az;
  const dLen = Math.hypot(dx, dy, dz);
  if (dLen < 1e-12) return;
  dx /= dLen;
  dy /= dLen;
  dz /= dLen;

  const [rx, ry, rz, sx, sy, sz] = orthonormalBasis(dx, dy, dz);

  const angles = new Float64Array(span);
  const ties = new Float64Array(span);
  const forward = new Uint8Array(span);
  const slots = new Uint32Array(span);

  for (let i = 0; i < span; i++) {
    const he = order[start + i];
    const t = (he / 3) | 0;
    const c = he - t * 3;
    const tail = indices[t * 3 + c];
    const apex = indices[t * 3 + ((c + 2) % 3)];

    let wx = positions[apex * 3] - ax;
    let wy = positions[apex * 3 + 1] - ay;
    let wz = positions[apex * 3 + 2] - az;
    const along = wx * dx + wy * dy + wz * dz;
    wx -= dx * along;
    wy -= dy * along;
    wz -= dz * along;

    const [nx, ny, nz] = triangleNormal(positions, indices, t);
    angles[i] = Math.atan2(wx * sx + wy * sy + wz * sz, wx * rx + wy * ry + wz * rz);
    ties[i] = (wy * nz - wz * ny) * dx + (wz * nx - wx * nz) * dy + (wx * ny - wy * nx) * dz;
    forward[i] = weldMap[tail] === originId ? 1 : 0;
    slots[i] = i;
  }

  slots.sort((a, b) =>
    Math.abs(angles[a] - angles[b]) > 1e-9 ? angles[a] - angles[b] : ties[b] - ties[a],
  );

  for (let i = 0; i < span; i++) {
    const self = slots[i];
    if (!forward[self]) continue;
    for (let step = 1; step <= span; step++) {
      const j = slots[(((i - step) % span) + span) % span];
      if (forward[j]) continue;
      union(parent, (order[start + self] / 3) | 0, (order[start + j] / 3) | 0);
      break;
    }
  }
}

function orthonormalBasis(dx: number, dy: number, dz: number): number[] {
  const useX = Math.abs(dx) < 0.9;
  let rx = useX ? 0 : dz;
  let ry = useX ? -dz : 0;
  let rz = useX ? dy : -dx;

  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  return [rx, ry, rz, dy * rz - dz * ry, dz * rx - dx * rz, dx * ry - dy * rx];
}

export function splitConnectedComponents(mesh: RawMesh, options?: SplitOptions): MeshComponent[] {
  const { positions, normals, indices } = mesh;
  const triangleCount = Math.floor(indices.length / 3);
  if (triangleCount === 0) return [];

  const tolerance = options?.weldTolerance ?? defaultWeldTolerance(positions);
  const { weldMap, weldedCount } = weldVertices(positions, tolerance);
  const parent = linkTriangles(
    positions,
    indices,
    weldMap,
    weldedCount,
    options?.separateTouching !== false,
  );

  const label = new Int32Array(triangleCount).fill(-1);
  const counts: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const root = findRoot(parent, t);
    if (label[root] < 0) {
      label[root] = counts.length;
      counts.push(0);
    }
    label[t] = label[root];
    counts[label[t]]++;
  }

  const offsets = new Uint32Array(counts.length + 1);
  for (let c = 0; c < counts.length; c++) offsets[c + 1] = offsets[c] + counts[c];
  const cursor = offsets.slice(0, counts.length);
  const sorted = new Uint32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) sorted[cursor[label[t]]++] = t;

  const minTriangles = Math.max(0, options?.minTriangles ?? 0);
  const scratch = new Int32Array(positions.length / 3).fill(-1);
  const components: MeshComponent[] = [];

  for (let c = 0; c < counts.length; c++) {
    if (counts[c] < minTriangles) continue;
    components.push(
      extractComponent(positions, normals, indices, sorted, offsets[c], offsets[c + 1], scratch),
    );
  }

  components.sort((a, b) => b.volume - a.volume || b.triangleCount - a.triangleCount);
  return components;
}

function extractComponent(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  triangles: Uint32Array,
  from: number,
  to: number,
  scratch: Int32Array,
): MeshComponent {
  const triangleCount = to - from;
  const outIndices = new Uint32Array(triangleCount * 3);
  let vertexCount = 0;

  for (let i = from; i < to; i++) {
    const t = triangles[i];
    for (let v = 0; v < 3; v++) {
      const source = indices[t * 3 + v];
      if (scratch[source] < 0) scratch[source] = vertexCount++;
      outIndices[(i - from) * 3 + v] = scratch[source];
    }
  }

  const hasNormals = normals.length >= positions.length;
  const outPositions = new Float32Array(vertexCount * 3);
  const outNormals = new Float32Array(hasNormals ? vertexCount * 3 : 0);

  for (let i = from; i < to; i++) {
    const t = triangles[i];
    for (let v = 0; v < 3; v++) {
      const source = indices[t * 3 + v];
      const target = scratch[source];
      outPositions[target * 3] = positions[source * 3];
      outPositions[target * 3 + 1] = positions[source * 3 + 1];
      outPositions[target * 3 + 2] = positions[source * 3 + 2];
      if (hasNormals) {
        outNormals[target * 3] = normals[source * 3];
        outNormals[target * 3 + 1] = normals[source * 3 + 1];
        outNormals[target * 3 + 2] = normals[source * 3 + 2];
      }
    }
  }

  for (let i = from; i < to; i++) {
    const t = triangles[i];
    for (let v = 0; v < 3; v++) scratch[indices[t * 3 + v]] = -1;
  }

  return {
    positions: outPositions,
    normals: outNormals,
    indices: outIndices,
    triangleCount,
    volume: Math.abs(meshVolume(outPositions, outIndices)),
  };
}

export function meshVolume(positions: Float32Array, indices: Uint32Array): number {
  let sum = 0;
  const triangleCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0],
      ay = positions[i0 + 1],
      az = positions[i0 + 2];
    const bx = positions[i1],
      by = positions[i1 + 1],
      bz = positions[i1 + 2];
    const cx = positions[i2],
      cy = positions[i2 + 1],
      cz = positions[i2 + 2];
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

export function componentToSolidData(
  component: MeshComponent,
  name: string,
  color?: number[],
  maxFaceGroups = DEFAULT_MAX_FACE_GROUPS,
): SerializedSolidData {
  const grouped = groupPlanarFaces(component.positions, component.indices, maxFaceGroups);

  return {
    name,
    color,
    positions: component.positions,
    normals: component.normals,
    indices: grouped.indices,
    faceGroups: grouped.faceGroups,
    faceGeometries: grouped.faceGeometries,
    edgeGroups: [],
    edgeGeometries: [],
    edgePolylines: new Float32Array(0),
  };
}

function groupPlanarFaces(
  positions: Float32Array,
  indices: Uint32Array,
  maxFaceGroups: number,
): { faceGroups: FaceGroupInfo[]; faceGeometries: FaceGeometryData[]; indices: Uint32Array } {
  const triangleCount = Math.floor(indices.length / 3);
  const single = {
    faceGroups: [{ start: 0, count: indices.length, faceIndex: 0 }],
    faceGeometries: [{ type: "face" } as FaceGeometryData],
    indices,
  };
  if (triangleCount === 0) return { faceGroups: [], faceGeometries: [], indices };

  const distTolerance = Math.max(defaultWeldTolerance(positions) * 200, 1e-3);
  const keys = new Float64Array(triangleCount);
  const normals = new Float32Array(triangleCount * 3);

  for (let t = 0; t < triangleCount; t++) {
    const [nx, ny, nz] = triangleNormal(positions, indices, t);
    normals[t * 3] = nx;
    normals[t * 3 + 1] = ny;
    normals[t * 3 + 2] = nz;

    const i0 = indices[t * 3] * 3;
    const d = nx * positions[i0] + ny * positions[i0 + 1] + nz * positions[i0 + 2];
    const base =
      Math.round(nx * 50) +
      64 +
      (Math.round(ny * 50) + 64) * 128 +
      (Math.round(nz * 50) + 64) * 16384;
    keys[t] = Math.round(d / distTolerance) * 2097152 + base;
  }

  const order = new Uint32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) order[t] = t;
  order.sort((a, b) => keys[a] - keys[b]);

  let groupCount = 1;
  for (let i = 1; i < triangleCount; i++) {
    if (keys[order[i]] !== keys[order[i - 1]]) groupCount++;
  }
  if (groupCount > maxFaceGroups) return single;

  const ordered = new Uint32Array(indices.length);
  const faceGroups: FaceGroupInfo[] = [];
  const faceGeometries: FaceGeometryData[] = [];
  let cursor = 0;
  let runStart = 0;

  while (runStart < triangleCount) {
    let runEnd = runStart + 1;
    while (runEnd < triangleCount && keys[order[runEnd]] === keys[order[runStart]]) runEnd++;

    const start = cursor;
    let sx = 0,
      sy = 0,
      sz = 0,
      nx = 0,
      ny = 0,
      nz = 0;

    for (let i = runStart; i < runEnd; i++) {
      const t = order[i];
      for (let v = 0; v < 3; v++) {
        const source = indices[t * 3 + v];
        ordered[cursor++] = source;
        sx += positions[source * 3];
        sy += positions[source * 3 + 1];
        sz += positions[source * 3 + 2];
      }
      nx += normals[t * 3];
      ny += normals[t * 3 + 1];
      nz += normals[t * 3 + 2];
    }

    const total = (runEnd - runStart) * 3;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    faceGroups.push({ start, count: cursor - start, faceIndex: faceGroups.length });
    faceGeometries.push({
      type: "plane",
      center: [sx / total, sy / total, sz / total],
      normal: [nx / nLen, ny / nLen, nz / nLen],
    });
    runStart = runEnd;
  }

  return { faceGroups, faceGeometries, indices: ordered };
}

function triangleNormal(
  positions: Float32Array,
  indices: Uint32Array,
  t: number,
): [number, number, number] {
  const i0 = indices[t * 3] * 3;
  const i1 = indices[t * 3 + 1] * 3;
  const i2 = indices[t * 3 + 2] * 3;
  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  return len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
}

export function splitSolidWithEdges(
  data: SerializedSolidData,
  options?: SplitOptions,
): SerializedSolidData[] {
  const tolerance = options?.weldTolerance ?? defaultWeldTolerance(data.positions);
  const components = splitConnectedComponents(
    { positions: data.positions, normals: data.normals, indices: data.indices },
    { ...options, weldTolerance: tolerance },
  );
  if (components.length === 0) return [];

  const pad = String(components.length).length;
  const baseName = data.name || "Solid";
  const solids = components.map((component, index) =>
    componentToSolidData(
      component,
      components.length === 1 ? baseName : `${baseName}_${String(index + 1).padStart(pad, "0")}`,
      data.color,
      options?.maxFaceGroups,
    ),
  );

  if (solids.length > 1) distributeEdges(solids, components, data, tolerance);
  return solids;
}

function distributeEdges(
  solids: SerializedSolidData[],
  components: MeshComponent[],
  source: SerializedSolidData,
  tolerance: number,
): void {
  const groups = source.edgeGroups;
  if (!groups || groups.length === 0 || source.edgePolylines.length === 0) return;

  const boxes = components.map((c) => bounds(c.positions));
  const margin = Math.max(tolerance * 20, 1e-3);

  const polylines: number[][] = solids.map(() => []);
  const edgeGroups: SerializedSolidData["edgeGroups"][] = solids.map(() => []);
  const edgeGeometries: SerializedSolidData["edgeGeometries"][] = solids.map(() => []);

  groups.forEach((group, groupIndex) => {
    if (group.polylineCount <= 0) return;
    const owner = pickOwner(source.edgePolylines, group, boxes, margin);
    if (owner < 0) return;

    const start = polylines[owner].length / 3;
    for (let p = 0; p < group.polylineCount; p++) {
      const base = (group.polylineStart + p) * 3;
      polylines[owner].push(
        source.edgePolylines[base],
        source.edgePolylines[base + 1],
        source.edgePolylines[base + 2],
      );
    }

    edgeGroups[owner].push({
      edgeIndex: edgeGroups[owner].length,
      polylineStart: start,
      polylineCount: group.polylineCount,
      adjacentFaceIndices: [],
    });
    const geometry = source.edgeGeometries?.[groupIndex];
    if (geometry) edgeGeometries[owner].push(geometry);
  });

  solids.forEach((solid, index) => {
    if (edgeGroups[index].length === 0) return;
    if (edgeGeometries[index].length !== edgeGroups[index].length) return;
    solid.edgeGroups = edgeGroups[index];
    solid.edgeGeometries = edgeGeometries[index];
    solid.edgePolylines = new Float32Array(polylines[index]);
  });
}

function pickOwner(
  polylines: Float32Array,
  group: SerializedSolidData["edgeGroups"][number],
  boxes: (Float64Array | null)[],
  margin: number,
): number {
  const samples = [0, group.polylineCount >> 1, group.polylineCount - 1];
  let best = -1;
  let bestVolume = Infinity;

  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    if (!box) continue;

    let inside = true;
    for (const sample of samples) {
      if (sample < 0 || sample >= group.polylineCount) continue;
      const base = (group.polylineStart + sample) * 3;
      for (let k = 0; k < 3; k++) {
        const v = polylines[base + k];
        if (v < box[k] - margin || v > box[k + 3] + margin) {
          inside = false;
          break;
        }
      }
      if (!inside) break;
    }
    if (!inside) continue;

    const volume =
      (box[3] - box[0] + margin) * (box[4] - box[1] + margin) * (box[5] - box[2] + margin);
    if (volume < bestVolume) {
      bestVolume = volume;
      best = index;
    }
  }

  return best;
}

export function buildFlatTree(
  rootName: string,
  solidNames: string[],
  rootType: TreeNodeType = "root",
): SerializedTreeNode {
  return {
    id: "root",
    name: rootName,
    type: rootType,
    children: solidNames.map((name, index) => ({
      id: `solid_${index}`,
      name,
      type: "solid" as TreeNodeType,
      solidIndex: index,
    })),
  };
}

const MASS_PROPS_SCALE = 1e-15;

function mergeMassProps(parts: SerializedSolidData[]): SolidMassProps | undefined {
  const all: SolidMassProps[] = [];
  let volume = 0;
  for (const part of parts) {
    if (!part.massProps || part.massProps.volume <= 0) return undefined;
    all.push(part.massProps);
    volume += part.massProps.volume;
  }
  if (volume <= 0) return undefined;

  const com: [number, number, number] = [0, 0, 0];
  for (const mp of all) {
    com[0] += mp.com[0] * mp.volume;
    com[1] += mp.com[1] * mp.volume;
    com[2] += mp.com[2] * mp.volume;
  }
  com[0] /= volume;
  com[1] /= volume;
  com[2] /= volume;

  const inertiaAtCom: SolidMassProps["inertiaAtCom"] = [0, 0, 0, 0, 0, 0];
  for (const mp of all) {
    const dx = mp.com[0] - com[0];
    const dy = mp.com[1] - com[1];
    const dz = mp.com[2] - com[2];
    const w = mp.volume * MASS_PROPS_SCALE;
    inertiaAtCom[0] += mp.inertiaAtCom[0] + w * (dy * dy + dz * dz);
    inertiaAtCom[1] += mp.inertiaAtCom[1] - w * dx * dy;
    inertiaAtCom[2] += mp.inertiaAtCom[2] - w * dx * dz;
    inertiaAtCom[3] += mp.inertiaAtCom[3] + w * (dx * dx + dz * dz);
    inertiaAtCom[4] += mp.inertiaAtCom[4] - w * dy * dz;
    inertiaAtCom[5] += mp.inertiaAtCom[5] + w * (dx * dx + dy * dy);
  }

  return { volume, com, inertiaAtCom };
}

export function mergeSolidData(
  parts: SerializedSolidData[],
  name: string,
  color?: number[],
): SerializedSolidData {
  if (parts.length === 1) return { ...parts[0], name, color: color ?? parts[0].color };

  let vertexTotal = 0;
  let indexTotal = 0;
  let polylineTotal = 0;
  for (const p of parts) {
    vertexTotal += p.positions.length;
    indexTotal += p.indices.length;
    polylineTotal += p.edgePolylines?.length ?? 0;
  }

  const positions = new Float32Array(vertexTotal);
  const normals = new Float32Array(vertexTotal);
  const indices = new Uint32Array(indexTotal);
  const edgePolylines = new Float32Array(polylineTotal);

  const faceGroups: FaceGroupInfo[] = [];
  const faceGeometries: FaceGeometryData[] = [];
  const edgeGroups: EdgeGroupInfo[] = [];
  const edgeGeometries: EdgeGeometryData[] = [];

  let vOffset = 0;
  let iOffset = 0;
  let pOffset = 0;
  let faceOffset = 0;
  let edgeOffset = 0;

  for (const part of parts) {
    positions.set(part.positions, vOffset);
    if (part.normals && part.normals.length === part.positions.length) {
      normals.set(part.normals, vOffset);
    }

    const vertexBase = vOffset / 3;
    for (let i = 0; i < part.indices.length; i++) {
      indices[iOffset + i] = part.indices[i] + vertexBase;
    }

    for (const g of part.faceGroups) {
      faceGroups.push({
        start: g.start + iOffset,
        count: g.count,
        faceIndex: g.faceIndex + faceOffset,
      });
    }
    faceGeometries.push(...part.faceGeometries);

    if (part.edgePolylines && part.edgePolylines.length > 0) {
      edgePolylines.set(part.edgePolylines, pOffset);
    }
    const polylineBase = pOffset / 3;
    for (const g of part.edgeGroups) {
      edgeGroups.push({
        edgeIndex: g.edgeIndex + edgeOffset,
        polylineStart: g.polylineStart + polylineBase,
        polylineCount: g.polylineCount,
        adjacentFaceIndices: g.adjacentFaceIndices.map((f) => f + faceOffset),
      });
    }
    edgeGeometries.push(...part.edgeGeometries);

    vOffset += part.positions.length;
    iOffset += part.indices.length;
    pOffset += part.edgePolylines?.length ?? 0;
    faceOffset += part.faceGeometries.length;
    edgeOffset += part.edgeGeometries.length;
  }

  return {
    name,
    color: color ?? parts[0].color,
    positions,
    normals,
    indices,
    faceGroups,
    faceGeometries,
    edgeGroups,
    edgeGeometries,
    edgePolylines,
    massProps: mergeMassProps(parts),
  };
}
