import * as Comlink from "comlink";
import type { KinematicsWorkerApi } from "./KinematicsWorker";
import type { KinematicsResult } from "../types";
import { createWorkerClient } from "./workerClient";

const client = createWorkerClient<KinematicsWorkerApi>(
  () => new Worker(new URL("./KinematicsWorker.ts", import.meta.url), { type: "module" }),
);

export async function computeRelativeTransform(
  parentWorldMatrix: ArrayLike<number>,
  snapPosition: [number, number, number],
  snapNormal: [number, number, number],
  frameBasis?: ArrayLike<number>,
): Promise<KinematicsResult> {
  const matBuf = Float32Array.from(parentWorldMatrix);
  const posBuf = Float32Array.from(snapPosition);
  const normBuf = Float32Array.from(snapNormal);
  const frameBuf = frameBasis ? Float32Array.from(frameBasis) : undefined;

  try {
    return await client
      .get()
      .computeRelativeTransform(
        Comlink.transfer(matBuf, [matBuf.buffer]),
        Comlink.transfer(posBuf, [posBuf.buffer]),
        Comlink.transfer(normBuf, [normBuf.buffer]),
        frameBuf ? Comlink.transfer(frameBuf, [frameBuf.buffer]) : undefined,
      );
  } catch {
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  }
}

export function disposeKinematicsWorker(): void {
  client.dispose();
}
