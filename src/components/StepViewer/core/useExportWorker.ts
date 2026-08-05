import * as Comlink from "comlink";
import type { ExportWorkerApi } from "./ExportWorker";
import type { SerializedSolidData } from "../types";
import { createWorkerClient } from "./workerClient";

const client = createWorkerClient<ExportWorkerApi>(
  () => new Worker(new URL("./ExportWorker.ts", import.meta.url), { type: "module" }),
);

let pending = 0;

export async function exportURDFInWorker(
  urdfXml: string,
  linkSolidMap: Record<string, SerializedSolidData[]>,
  linkRestInverseMap: Record<string, number[]>,
  unitScale: number,
  onProgress?: (stage: string, percent: number) => void,
  extraFiles?: Record<string, string>,
): Promise<Blob> {
  pending++;
  try {
    return await client
      .get()
      .exportURDF(
        urdfXml,
        linkSolidMap,
        linkRestInverseMap,
        unitScale,
        onProgress ? Comlink.proxy(onProgress) : undefined,
        extraFiles,
      );
  } finally {
    pending--;
    if (pending === 0) client.dispose();
  }
}

export function disposeExportWorker(): void {
  client.dispose();
}
