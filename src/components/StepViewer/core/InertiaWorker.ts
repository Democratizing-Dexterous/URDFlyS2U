import * as Comlink from "comlink";
import type { SerializedSolidData, SolidMassProps, SolidInertiaResult } from "../types";

const SUM_SLOTS = 10;

function neumaierAdd(sums: Float64Array, comps: Float64Array, i: number, value: number): void {
  const s = sums[i];
  const t = s + value;
  comps[i] += Math.abs(s) >= Math.abs(value) ? s - t + value : value - t + s;
  sums[i] = t;
}

function neumaierTotal(sums: Float64Array, comps: Float64Array, i: number): number {
  return sums[i] + comps[i];
}

function boundsCenter(positions: ArrayLike<number>): [number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minX)) return [0, 0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function meshMassProps(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): SolidMassProps | null {
  if (positions.length < 9 || indices.length < 3) return null;

  const [rx, ry, rz] = boundsCenter(positions);
  const sums = new Float64Array(SUM_SLOTS);
  const comps = new Float64Array(SUM_SLOTS);

  const nTri = Math.floor(indices.length / 3);
  for (let t = 0; t < nTri; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    const ax = positions[i0] - rx,
      ay = positions[i0 + 1] - ry,
      az = positions[i0 + 2] - rz;
    const bx = positions[i1] - rx,
      by = positions[i1 + 1] - ry,
      bz = positions[i1 + 2] - rz;
    const cx = positions[i2] - rx,
      cy = positions[i2 + 1] - ry,
      cz = positions[i2 + 2] - rz;

    const w = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    if (w === 0) continue;

    neumaierAdd(sums, comps, 0, w);
    neumaierAdd(sums, comps, 1, w * (ax + bx + cx));
    neumaierAdd(sums, comps, 2, w * (ay + by + cy));
    neumaierAdd(sums, comps, 3, w * (az + bz + cz));
    neumaierAdd(sums, comps, 4, w * (ax * ax + bx * bx + cx * cx + ax * bx + ax * cx + bx * cx));
    neumaierAdd(sums, comps, 5, w * (ay * ay + by * by + cy * cy + ay * by + ay * cy + by * cy));
    neumaierAdd(sums, comps, 6, w * (az * az + bz * bz + cz * cz + az * bz + az * cz + bz * cz));
    neumaierAdd(
      sums,
      comps,
      7,
      w *
        (2 * ax * ay +
          2 * bx * by +
          2 * cx * cy +
          ax * by +
          ay * bx +
          ax * cy +
          ay * cx +
          bx * cy +
          by * cx),
    );
    neumaierAdd(
      sums,
      comps,
      8,
      w *
        (2 * ax * az +
          2 * bx * bz +
          2 * cx * cz +
          ax * bz +
          az * bx +
          ax * cz +
          az * cx +
          bx * cz +
          bz * cx),
    );
    neumaierAdd(
      sums,
      comps,
      9,
      w *
        (2 * ay * az +
          2 * by * bz +
          2 * cy * cz +
          ay * bz +
          az * by +
          ay * cz +
          az * cy +
          by * cz +
          bz * cy),
    );
  }

  let sW = neumaierTotal(sums, comps, 0);
  if (Math.abs(sW) < 1e-12) return null;

  const sign = sW < 0 ? -1 : 1;
  sW *= sign;
  const sWx = neumaierTotal(sums, comps, 1) * sign;
  const sWy = neumaierTotal(sums, comps, 2) * sign;
  const sWz = neumaierTotal(sums, comps, 3) * sign;
  const sWxx = neumaierTotal(sums, comps, 4) * sign;
  const sWyy = neumaierTotal(sums, comps, 5) * sign;
  const sWzz = neumaierTotal(sums, comps, 6) * sign;
  const sWxy = neumaierTotal(sums, comps, 7) * sign;
  const sWxz = neumaierTotal(sums, comps, 8) * sign;
  const sWyz = neumaierTotal(sums, comps, 9) * sign;

  const volume = sW / 6;
  const lx = sWx / (4 * sW);
  const ly = sWy / (4 * sW);
  const lz = sWz / (4 * sW);

  const s = 1e-15;
  return {
    volume,
    com: [lx + rx, ly + ry, lz + rz],
    inertiaAtCom: [
      ((sWyy + sWzz) / 60 - volume * (ly * ly + lz * lz)) * s,
      (-sWxy / 120 + volume * lx * ly) * s,
      (-sWxz / 120 + volume * lx * lz) * s,
      ((sWxx + sWzz) / 60 - volume * (lx * lx + lz * lz)) * s,
      (-sWyz / 120 + volume * ly * lz) * s,
      ((sWxx + sWyy) / 60 - volume * (lx * lx + ly * ly)) * s,
    ],
  };
}

function solidMassProps(data: SerializedSolidData): SolidMassProps | null {
  if (data.massProps && data.massProps.volume > 0) return data.massProps;
  return meshMassProps(data.positions, data.indices);
}

export const workerApi = {
  async init(): Promise<void> {
    return;
  },

  async computePerSolidInertia(
    solidDataList: SerializedSolidData[],
  ): Promise<SolidInertiaResult[]> {
    return solidDataList.map((data, index) => {
      const props = solidMassProps(data);
      if (!props) {
        return {
          index,
          name: data.name ?? "",
          volume: 0,
          refMass: 0,
          com: [0, 0, 0] as [number, number, number],
          inertiaAtCom: [0, 0, 0, 0, 0, 0] as SolidMassProps["inertiaAtCom"],
        };
      }
      return {
        index,
        name: data.name ?? "",
        volume: props.volume,
        refMass: props.volume * 1e-9,
        com: props.com,
        inertiaAtCom: props.inertiaAtCom,
      };
    });
  },
};

export type InertiaWorkerApi = typeof workerApi;

Comlink.expose(workerApi);
