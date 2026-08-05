import * as Comlink from "comlink";
import { OcctKernel, type ShapeHandle } from "occt-wasm";
import occtWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";
import { HASH_UPPER_BOUND, extractFaceGeometry, extractEdgeGeometry } from "./OcctGeometry";
import type {
  WorkerRequest,
  WorkerResponse,
  SerializedSolidData,
  SerializedTreeNode,
  SolidMassProps,
  FaceGroupInfo,
  FaceGeometryData,
  EdgeGroupInfo,
  EdgeGeometryData,
} from "../types";

const DEFLECTION_RATIO = 5e-4;
const DEFLECTION_MIN = 0.02;
const DEFLECTION_MAX = 1.0;
const ANGULAR_DEFLECTION = 0.5;
const MM5_TO_M5 = 1e-15;
const DEGENERATE_LENGTH = 1e-9;

let kernel: OcctKernel | null = null;
let progressCb: ProgressCallback | null = null;

export type ProgressCallback = (stage: string, percent: number) => void;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (msg.type === "progress" && progressCb) {
    try {
      progressCb(msg.stage, msg.percent);
    } catch {}
  }
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

async function initKernel(): Promise<OcctKernel> {
  if (kernel) return kernel;

  post({ type: "progress", stage: "正在加载 OpenCascade WASM 引擎...", percent: 5 });

  try {
    kernel = await OcctKernel.init({ wasm: occtWasmUrl });
    return kernel;
  } catch (error) {
    throw new Error(
      `OpenCascade WASM 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function computeDeflection(k: OcctKernel, shape: ShapeHandle): number {
  try {
    const box = k.getBoundingBox(shape, false);
    const diag = Math.hypot(box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin);
    if (!isFinite(diag) || diag <= 0) return DEFLECTION_MIN;
    return Math.min(Math.max(diag * DEFLECTION_RATIO, DEFLECTION_MIN), DEFLECTION_MAX);
  } catch {
    return DEFLECTION_MIN;
  }
}

function isPhysicallyValidInertia(
  ixx: number,
  ixy: number,
  ixz: number,
  iyy: number,
  iyz: number,
  izz: number,
): boolean {
  if (![ixx, ixy, ixz, iyy, iyz, izz].every(isFinite)) return false;
  if (ixx <= 0 || iyy <= 0 || izz <= 0) return false;

  const scale = Math.max(ixx, iyy, izz);
  const slack = scale * 1e-6;
  if (ixx + iyy < izz - slack) return false;
  if (iyy + izz < ixx - slack) return false;
  if (izz + ixx < iyy - slack) return false;

  const det =
    ixx * (iyy * izz - iyz * iyz) - ixy * (ixy * izz - iyz * ixz) + ixz * (ixy * iyz - iyy * ixz);
  if (!(det > 0)) return false;
  if (ixx * iyy - ixy * ixy <= 0) return false;

  return true;
}

function computeMassProps(k: OcctKernel, solid: ShapeHandle): SolidMassProps | undefined {
  try {
    const volume = k.getVolume(solid);
    if (!isFinite(volume) || volume <= 0) return undefined;

    const com = k.getCenterOfMass(solid);
    if (!isFinite(com.x) || !isFinite(com.y) || !isFinite(com.z)) return undefined;

    const m = k.getInertia(solid);
    if (!m || m.length < 9) return undefined;

    const ixx = m[0],
      ixy = m[1],
      ixz = m[2],
      iyy = m[4],
      iyz = m[5],
      izz = m[8];
    if (!isPhysicallyValidInertia(ixx, ixy, ixz, iyy, iyz, izz)) return undefined;

    return {
      volume,
      com: [com.x, com.y, com.z],
      inertiaAtCom: [
        ixx * MM5_TO_M5,
        ixy * MM5_TO_M5,
        ixz * MM5_TO_M5,
        iyy * MM5_TO_M5,
        iyz * MM5_TO_M5,
        izz * MM5_TO_M5,
      ],
    };
  } catch {
    return undefined;
  }
}

function checkCircularPlaneFace(
  positions: Float32Array,
  startVertex: number,
  vertexCount: number,
): FaceGeometryData | null {
  if (vertexCount < 6) return null;

  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    const vi = (startVertex + i) * 3;
    cx += positions[vi];
    cy += positions[vi + 1];
    cz += positions[vi + 2];
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;

  let sumDist = 0;
  for (let i = 0; i < vertexCount; i++) {
    const vi = (startVertex + i) * 3;
    sumDist += Math.hypot(positions[vi] - cx, positions[vi + 1] - cy, positions[vi + 2] - cz);
  }
  const avgDist = sumDist / vertexCount;
  if (avgDist < 0.001) return null;

  const tolerance = avgDist * 0.1;
  for (let i = 0; i < vertexCount; i++) {
    const vi = (startVertex + i) * 3;
    const d = Math.hypot(positions[vi] - cx, positions[vi + 1] - cy, positions[vi + 2] - cz);
    if (Math.abs(d - avgDist) >= tolerance) return null;
  }

  return { type: "circle", center: [cx, cy, cz], radius: avgDist };
}

function orientFaceNormals(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  indexStart: number,
  indexCount: number,
): void {
  const end = Math.min(indexStart + indexCount, indices.length);
  let agree = 0;
  let disagree = 0;

  for (let i = indexStart; i + 2 < end; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];

    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;

    const nx = normals[i0] + normals[i1] + normals[i2];
    const ny = normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1];
    const nz = normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2];

    if (Math.hypot(nx, ny, nz) < 1e-9 || Math.hypot(gx, gy, gz) < 1e-12) continue;

    if (gx * nx + gy * ny + gz * nz >= 0) agree++;
    else disagree++;
  }

  if (disagree <= agree) return;

  const seen = new Set<number>();
  for (let i = indexStart; i < end; i++) seen.add(indices[i]);
  for (const v of seen) {
    const o = v * 3;
    normals[o] = -normals[o];
    normals[o + 1] = -normals[o + 1];
    normals[o + 2] = -normals[o + 2];
  }
}

function refineFaceGeometry(
  geom: FaceGeometryData,
  positions: Float32Array,
  indices: Uint32Array,
  indexStart: number,
  indexCount: number,
): FaceGeometryData {
  if (geom.type !== "plane" || indexCount === 0) return geom;

  const seen = new Set<number>();
  const end = Math.min(indexStart + indexCount, indices.length);
  for (let i = indexStart; i < end; i++) seen.add(indices[i]);
  const unique = Array.from(seen);
  if (unique.length < 6) return geom;

  const packed = new Float32Array(unique.length * 3);
  for (let i = 0; i < unique.length; i++) {
    const vi = unique[i] * 3;
    packed[i * 3] = positions[vi];
    packed[i * 3 + 1] = positions[vi + 1];
    packed[i * 3 + 2] = positions[vi + 2];
  }

  const circle = checkCircularPlaneFace(packed, 0, unique.length);
  if (!circle) return geom;
  circle.normal = geom.normal;
  return circle;
}

function buildFaceIndexMap(k: OcctKernel, faces: ShapeHandle[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < faces.length; i++) {
    try {
      map.set(k.hashCode(faces[i], HASH_UPPER_BOUND), i);
    } catch {}
  }
  return map;
}

function buildEdgeAdjacency(
  k: OcctKernel,
  solid: ShapeHandle,
  edgeIndexByHash: Map<number, number>,
  faceIndexByHash: Map<number, number>,
): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  try {
    const flat = k.edgeToFaceMap(solid, HASH_UPPER_BOUND);
    let i = 0;
    while (i + 1 < flat.length) {
      const edgeHash = flat[i];
      const count = flat[i + 1];
      if (!isFinite(count) || count < 0 || i + 2 + count > flat.length) break;
      const edgeIndex = edgeIndexByHash.get(edgeHash);
      if (edgeIndex !== undefined && !adjacency.has(edgeIndex)) {
        const faceIndices: number[] = [];
        for (let j = 0; j < count; j++) {
          const faceIndex = faceIndexByHash.get(flat[i + 2 + j]);
          if (faceIndex !== undefined) faceIndices.push(faceIndex);
        }
        adjacency.set(edgeIndex, faceIndices);
      }
      i += 2 + count;
    }
  } catch {}
  return adjacency;
}

function extractEdges(
  k: OcctKernel,
  solid: ShapeHandle,
  deflection: number,
  faceIndexByHash: Map<number, number>,
): {
  edgeGroups: EdgeGroupInfo[];
  edgeGeometries: EdgeGeometryData[];
  edgePolylines: Float32Array;
} {
  const edgeGroups: EdgeGroupInfo[] = [];
  const edgeGeometries: EdgeGeometryData[] = [];
  const chunks: Float32Array[] = [];
  let totalFloats = 0;
  let polylineOffset = 0;

  try {
    const edges = k.getSubShapes(solid, "edge");
    const edgeIndexByHash = new Map<number, number>();
    for (let i = 0; i < edges.length; i++) {
      try {
        edgeIndexByHash.set(k.hashCode(edges[i], HASH_UPPER_BOUND), i);
      } catch {}
    }

    const adjacency = buildEdgeAdjacency(k, solid, edgeIndexByHash, faceIndexByHash);
    const wire = k.wireframe(solid, deflection);

    for (let g = 0; g < wire.edgeCount; g++) {
      const floatStart = wire.edgeGroups[g * 3];
      const floatCount = wire.edgeGroups[g * 3 + 1];
      const edgeIndex = edgeIndexByHash.get(wire.edgeGroups[g * 3 + 2]);
      if (edgeIndex === undefined || floatCount < 6) continue;

      const geom = extractEdgeGeometry(k, edges[edgeIndex]);
      if (geom.length <= DEGENERATE_LENGTH) continue;

      const polyline = wire.points.slice(floatStart, floatStart + floatCount);
      const polylineCount = floatCount / 3;

      edgeGroups.push({
        edgeIndex: edgeGroups.length,
        polylineStart: polylineOffset,
        polylineCount,
        adjacentFaceIndices: adjacency.get(edgeIndex) ?? [],
      });
      edgeGeometries.push(geom);
      chunks.push(polyline);
      totalFloats += floatCount;
      polylineOffset += polylineCount;
    }
  } catch {}

  const edgePolylines = new Float32Array(totalFloats);
  let writeOffset = 0;
  for (const chunk of chunks) {
    edgePolylines.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return { edgeGroups, edgeGeometries, edgePolylines };
}

function extractSingleSolid(
  k: OcctKernel,
  solid: ShapeHandle,
  solidIndex: number,
  deflection: number,
): SerializedSolidData | null {
  const mark = k.checkpoint();
  try {
    const mesh = k.meshShape(solid, {
      linearDeflection: deflection,
      angularDeflection: ANGULAR_DEFLECTION,
    });
    if (!mesh || mesh.vertexCount === 0 || mesh.triangleCount === 0) return null;

    const faces = k.getSubShapes(solid, "face");
    const faceIndexByHash = buildFaceIndexMap(k, faces);
    const faceGeometries: FaceGeometryData[] = faces.map((face) => extractFaceGeometry(k, face));

    const faceGroups: FaceGroupInfo[] = [];
    const groupCount = mesh.faceCount ?? 0;
    const groups = mesh.faceGroups;
    if (groups) {
      for (let g = 0; g < groupCount; g++) {
        const indexStart = groups[g * 3];
        const indexCount = groups[g * 3 + 1];
        const faceIndex = faceIndexByHash.get(groups[g * 3 + 2]);
        if (faceIndex === undefined || indexCount <= 0) continue;
        faceGroups.push({ start: indexStart, count: indexCount, faceIndex });
        orientFaceNormals(mesh.positions, mesh.normals, mesh.indices, indexStart, indexCount);
        faceGeometries[faceIndex] = refineFaceGeometry(
          faceGeometries[faceIndex],
          mesh.positions,
          mesh.indices,
          indexStart,
          indexCount,
        );
      }
    }

    const edgeData = extractEdges(k, solid, deflection, faceIndexByHash);

    return {
      name: `Solid_${solidIndex}`,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      faceGroups,
      faceGeometries,
      edgeGroups: edgeData.edgeGroups,
      edgeGeometries: edgeData.edgeGeometries,
      edgePolylines: edgeData.edgePolylines,
      massProps: computeMassProps(k, solid),
    };
  } catch {
    return null;
  } finally {
    k.releaseSince(mark);
  }
}

function getEdgeDisplayName(curveType: string): string {
  const names: Record<string, string> = {
    line: "直线",
    circle: "圆弧",
    ellipse: "椭圆弧",
    bspline: "B样条曲线",
    bezier: "贝塞尔曲线",
    other: "曲线",
  };
  return names[curveType] || "边";
}

function buildSolidTreeNode(
  solidIndex: number,
  solidData: SerializedSolidData,
): SerializedTreeNode {
  return {
    id: `solid_${solidIndex}`,
    name: solidData.name || `Solid_${solidIndex}`,
    type: "solid",
    solidIndex,
    children: solidData.edgeGeometries.map((geom, edgeIdx) => ({
      id: `solid_${solidIndex}_edge_${edgeIdx}`,
      name: `${getEdgeDisplayName(geom.curveType)}_${edgeIdx}`,
      type: "edge" as const,
      solidIndex,
      edgeIndex: edgeIdx,
    })),
  };
}

interface PendingNode {
  candidateIndex?: number;
  id: string;
  name: string;
  type: SerializedTreeNode["type"];
  children: PendingNode[];
}

function parseStepFile(
  k: OcctKernel,
  fileBuffer: ArrayBuffer,
): {
  solids: SerializedSolidData[];
  tree: SerializedTreeNode;
  transferList: Transferable[];
} {
  const mark = k.checkpoint();

  try {
    post({ type: "progress", stage: "正在读取 STEP 文件...", percent: 15 });

    let root: ShapeHandle;
    try {
      root = k.importStep(fileBuffer);
    } catch (error) {
      throw new Error(
        `STEP 文件读取失败，请检查文件是否损坏: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (k.isNull(root)) throw new Error("STEP 文件读取失败，请检查文件是否损坏");

    post({ type: "progress", stage: "正在分析模型结构...", percent: 35 });

    const candidates: ShapeHandle[] = [];
    let compoundIndex = 0;

    const collect = (shape: ShapeHandle, depth: number): PendingNode | null => {
      const shapeType = k.getShapeType(shape);

      if (shapeType === "solid" || shapeType === "shell" || shapeType === "face") {
        const candidateIndex = candidates.length;
        candidates.push(shape);
        return { candidateIndex, id: "", name: "", type: "solid", children: [] };
      }

      if (shapeType === "compound" || shapeType === "compsolid") {
        const compId = compoundIndex++;
        const children: PendingNode[] = [];
        for (const child of k.iterShapes(shape)) {
          const node = collect(child, depth + 1);
          if (node) children.push(node);
        }
        if (children.length === 0) return null;
        if (depth === 0) {
          return { id: "root", name: "Model", type: "root", children };
        }
        return {
          id: `compound_${compId}`,
          name: `Component_${compId}`,
          type: "compound",
          children,
        };
      }

      return null;
    };

    const rootType = k.getShapeType(root);
    const isCompound = rootType === "compound" || rootType === "compsolid";
    const pendingRoot = isCompound
      ? collect(root, 0)
      : {
          id: "root",
          name: "Model",
          type: "root" as const,
          children: [collect(root, 1)].filter(Boolean) as PendingNode[],
        };

    const deflection = computeDeflection(k, root);
    const solids: SerializedSolidData[] = [];
    const indexMap = new Int32Array(candidates.length).fill(-1);

    for (let i = 0; i < candidates.length; i++) {
      const solidData = extractSingleSolid(k, candidates[i], solids.length, deflection);
      if (solidData) {
        indexMap[i] = solids.length;
        solids.push(solidData);
      }

      const done = i + 1;
      post({
        type: "progress",
        stage: `正在处理实体 ${done}/${candidates.length}...`,
        percent: Math.min(40 + Math.round((done / Math.max(candidates.length, 1)) * 45), 85),
      });
    }

    const materialize = (node: PendingNode): SerializedTreeNode | null => {
      if (node.candidateIndex !== undefined) {
        const solidIndex = indexMap[node.candidateIndex];
        if (solidIndex < 0) return null;
        return buildSolidTreeNode(solidIndex, solids[solidIndex]);
      }
      const children = node.children
        .map(materialize)
        .filter((n): n is SerializedTreeNode => n !== null);
      if (children.length === 0) return null;
      return { id: node.id, name: node.name, type: node.type, children };
    };

    const tree = (pendingRoot && materialize(pendingRoot)) || {
      id: "root",
      name: "Model",
      type: "root" as const,
      children: [],
    };

    post({ type: "progress", stage: "正在传输数据...", percent: 90 });

    const transferList: Transferable[] = [];
    for (const solid of solids) {
      transferList.push(solid.positions.buffer);
      transferList.push(solid.normals.buffer);
      transferList.push(solid.indices.buffer);
      if (solid.edgePolylines.byteLength > 0) {
        transferList.push(solid.edgePolylines.buffer);
      }
    }

    return { solids, tree, transferList };
  } finally {
    k.releaseSince(mark);
  }
}

export const workerApi = {
  async init(): Promise<void> {
    await initKernel();
  },

  async parse(
    fileBuffer: ArrayBuffer,
    onProgress?: ProgressCallback,
  ): Promise<{ solids: SerializedSolidData[]; tree: SerializedTreeNode }> {
    progressCb = onProgress ?? null;
    try {
      const k = await initKernel();
      const { solids, tree } = parseStepFile(k, fileBuffer);
      return { solids, tree };
    } finally {
      progressCb = null;
    }
  },
};

export type StepParseWorkerApi = typeof workerApi;

Comlink.expose(workerApi);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data && typeof event.data === "object" && !("type" in event.data)) return;

  const request = event.data;

  try {
    switch (request.type) {
      case "init": {
        await initKernel();
        post({ type: "ready" });
        break;
      }

      case "parse": {
        const k = await initKernel();
        const { solids, tree, transferList } = parseStepFile(k, request.fileBuffer);
        post({ type: "progress", stage: "传输数据中...", percent: 95 });
        post({ type: "result", solids, tree, success: true }, transferList);
        break;
      }
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "未知解析错误",
    });
  }
};

post({ type: "progress", stage: "Worker 已就绪", percent: 0 });
