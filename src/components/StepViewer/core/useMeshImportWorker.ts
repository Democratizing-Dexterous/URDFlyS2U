import * as Comlink from "comlink";
import type { MeshImportWorkerApi, MeshImportOptions, MeshImportResult } from "./MeshImportWorker";
import type { SerializedSolidData, UploadProgress } from "../types";
import { createWorkerClient } from "./workerClient";

const client = createWorkerClient<MeshImportWorkerApi>(
  () => new Worker(new URL("./MeshImportWorker.ts", import.meta.url), { type: "module" }),
  (proxy) => proxy.init(),
);

export const MESH_UNIT_SCALES: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
};

export async function importStlSolids(
  buffer: ArrayBuffer,
  options: MeshImportOptions,
  onProgress?: (progress: UploadProgress) => void,
): Promise<MeshImportResult> {
  const proxy = await client.ready();
  const callback = onProgress
    ? Comlink.proxy((stage: string, percent: number) => {
        onProgress({
          status: "parsing",
          progress: Math.min(Math.round(percent), 99),
          message: stage,
        });
      })
    : undefined;
  return proxy.importStl(Comlink.transfer(buffer, [buffer]), options, callback);
}

export async function splitSolidData(
  data: SerializedSolidData,
  options: MeshImportOptions,
): Promise<SerializedSolidData[]> {
  const proxy = await client.ready();
  const copy: SerializedSolidData = {
    ...data,
    positions: data.positions.slice(),
    normals: (data.normals ?? new Float32Array(0)).slice(),
    indices: data.indices.slice(),
    edgePolylines: (data.edgePolylines ?? new Float32Array(0)).slice(),
    faceGroups: [],
    faceGeometries: [],
    edgeGroups: data.edgeGroups ? [...data.edgeGroups] : [],
    edgeGeometries: data.edgeGeometries ? [...data.edgeGeometries] : [],
  };
  return proxy.splitSolid(
    Comlink.transfer(copy, [
      copy.positions.buffer,
      copy.normals.buffer,
      copy.indices.buffer,
      copy.edgePolylines.buffer,
    ] as unknown as Transferable[]),
    options,
  );
}

export function disposeMeshImportWorker(): void {
  client.dispose();
}
