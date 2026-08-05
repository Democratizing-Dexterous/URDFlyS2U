import * as Comlink from "comlink";
import { parseStl } from "./StlParser";
import {
  splitConnectedComponents,
  componentToSolidData,
  defaultWeldTolerance,
  splitSolidWithEdges,
  type SplitOptions,
} from "./MeshSplitter";
import type { SerializedSolidData } from "../types";

export interface MeshImportOptions extends SplitOptions {
  scale?: number;
  autoScale?: boolean;
  split?: boolean;
  baseName?: string;
  color?: number[];
}

export interface MeshImportResult {
  solids: SerializedSolidData[];
  scale: number;
  diagonal: number;
  triangles: number;
}

export type MeshProgress = (stage: string, percent: number) => void;

function report(onProgress: MeshProgress | undefined, stage: string, percent: number): void {
  if (!onProgress) return;
  try {
    onProgress(stage, percent);
  } catch {}
}

function buildSolids(
  mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array },
  options: MeshImportOptions,
  onProgress?: MeshProgress,
): SerializedSolidData[] {
  const baseName = options.baseName || "Mesh";
  const tolerance = options.weldTolerance ?? defaultWeldTolerance(mesh.positions);

  if (options.split === false) {
    return [
      componentToSolidData(
        {
          positions: mesh.positions,
          normals: mesh.normals,
          indices: mesh.indices,
          triangleCount: Math.floor(mesh.indices.length / 3),
          volume: 0,
        },
        baseName,
        options.color,
        options.maxFaceGroups,
      ),
    ];
  }

  report(onProgress, "正在按拓扑连通性拆解实体...", 45);
  const components = splitConnectedComponents(mesh, {
    weldTolerance: tolerance,
    minTriangles: options.minTriangles,
    separateTouching: options.separateTouching,
  });

  report(onProgress, `正在生成 ${components.length} 个实体...`, 75);
  const pad = String(components.length).length;
  return components.map((component, index) =>
    componentToSolidData(
      component,
      components.length === 1 ? baseName : `${baseName}_${String(index + 1).padStart(pad, "0")}`,
      options.color,
      options.maxFaceGroups,
    ),
  );
}

function boundsDiagonal(positions: Float32Array): number {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  if (!isFinite(minX)) return 0;
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function inferScale(diagonal: number): number {
  if (!(diagonal > 0)) return 1;
  return diagonal < 10 ? 1000 : 1;
}

export const workerApi = {
  async init(): Promise<void> {
    return;
  },

  async importStl(
    buffer: ArrayBuffer,
    options: MeshImportOptions,
    onProgress?: MeshProgress,
  ): Promise<MeshImportResult> {
    report(onProgress, "正在解析 STL 网格...", 15);
    const mesh = parseStl(buffer, 1);
    if (mesh.indices.length < 3) {
      throw new Error("STL 中没有有效三角面");
    }

    const rawDiagonal = boundsDiagonal(mesh.positions);
    const scale = options.autoScale ? inferScale(rawDiagonal) : (options.scale ?? 1);
    if (scale !== 1) {
      for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] *= scale;
    }

    const solids = buildSolids(mesh, options, onProgress);
    report(onProgress, "网格处理完成", 100);

    const result: MeshImportResult = {
      solids,
      scale,
      diagonal: rawDiagonal * scale,
      triangles: Math.floor(mesh.indices.length / 3),
    };

    return Comlink.transfer(
      result,
      solids.flatMap((s) => [
        s.positions.buffer,
        s.normals.buffer,
        s.indices.buffer,
      ]) as unknown as Transferable[],
    );
  },

  async splitSolid(
    data: SerializedSolidData,
    options: MeshImportOptions,
  ): Promise<SerializedSolidData[]> {
    const solids = splitSolidWithEdges(data, {
      weldTolerance: options.weldTolerance,
      minTriangles: options.minTriangles,
      maxFaceGroups: options.maxFaceGroups,
      separateTouching: options.separateTouching,
    });
    return Comlink.transfer(
      solids,
      solids.flatMap((s) => [
        s.positions.buffer,
        s.normals.buffer,
        s.indices.buffer,
        s.edgePolylines.buffer,
      ]) as unknown as Transferable[],
    );
  },
};

export type MeshImportWorkerApi = typeof workerApi;

Comlink.expose(workerApi);
