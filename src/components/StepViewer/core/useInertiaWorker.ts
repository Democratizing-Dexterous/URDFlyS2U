import type { InertiaWorkerApi } from "./InertiaWorker";
import type {
  SerializedSolidData,
  InertialParams,
  SolidInertiaResult,
  SolidMassEntry,
} from "../types";
import { createWorkerClient } from "./workerClient";

const EMPTY_F32 = new Float32Array(0);

const client = createWorkerClient<InertiaWorkerApi>(
  () => new Worker(new URL("./InertiaWorker.ts", import.meta.url), { type: "module" }),
  (proxy) => proxy.init(),
);

function toPlainSolidData(solidDataList: SerializedSolidData[]): SerializedSolidData[] {
  return solidDataList.map((d) => ({
    name: d.name ?? "",
    positions: d.positions,
    normals: d.normals ?? EMPTY_F32,
    indices: d.indices,
    faceGroups: [],
    faceGeometries: [],
    edgeGroups: [],
    edgeGeometries: [],
    edgePolylines: EMPTY_F32,
    massProps: d.massProps,
  }));
}

export async function computePerSolidInertia(
  solidDataList: SerializedSolidData[],
): Promise<SolidInertiaResult[]> {
  const proxy = await client.ready();
  return proxy.computePerSolidInertia(toPlainSolidData(solidDataList));
}

export function combineSolidInertia(entries: SolidMassEntry[]): InertialParams {
  const valid = entries.filter((e) => e.mass > 0 && e.refMass > 0);
  if (valid.length === 0) {
    return { mass: 0, com: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0] };
  }

  let mass = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const e of valid) {
    mass += e.mass;
    cx += e.mass * e.com[0];
    cy += e.mass * e.com[1];
    cz += e.mass * e.com[2];
  }
  const com: [number, number, number] = [cx / mass, cy / mass, cz / mass];

  const inertia: InertialParams["inertia"] = [0, 0, 0, 0, 0, 0];
  for (const e of valid) {
    const k = e.mass / e.refMass;
    const dx = (e.com[0] - com[0]) * 1e-3;
    const dy = (e.com[1] - com[1]) * 1e-3;
    const dz = (e.com[2] - com[2]) * 1e-3;
    inertia[0] += e.inertiaAtCom[0] * k + e.mass * (dy * dy + dz * dz);
    inertia[1] += e.inertiaAtCom[1] * k - e.mass * dx * dy;
    inertia[2] += e.inertiaAtCom[2] * k - e.mass * dx * dz;
    inertia[3] += e.inertiaAtCom[3] * k + e.mass * (dx * dx + dz * dz);
    inertia[4] += e.inertiaAtCom[4] * k - e.mass * dy * dz;
    inertia[5] += e.inertiaAtCom[5] * k + e.mass * (dx * dx + dy * dy);
  }

  return { mass, com, inertia };
}

export function principalAxisQuat(
  inertia: readonly [number, number, number, number, number, number],
): [number, number, number, number] {
  const a = [
    [inertia[0], inertia[1], inertia[2]],
    [inertia[1], inertia[3], inertia[4]],
    [inertia[2], inertia[4], inertia[5]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const scale = Math.max(Math.abs(a[0][0]), Math.abs(a[1][1]), Math.abs(a[2][2]), 1e-30);
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  for (let sweep = 0; sweep < 64; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off <= scale * 1e-14) break;
    for (const [p, q] of pairs) {
      const apq = a[p][q];
      if (Math.abs(apq) <= scale * 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const sign = theta >= 0 ? 1 : -1;
      const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
      a[p][q] = 0;
      a[q][p] = 0;
    }
  }

  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  const m = [
    [v[0][order[0]], v[0][order[1]], v[0][order[2]]],
    [v[1][order[0]], v[1][order[1]], v[1][order[2]]],
    [v[2][order[0]], v[2][order[1]], v[2][order[2]]],
  ];

  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (det < 0) {
    m[0][2] = -m[0][2];
    m[1][2] = -m[1][2];
    m[2][2] = -m[2][2];
  }

  const trace = m[0][0] + m[1][1] + m[2][2];
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

export function disposeInertiaWorker(): void {
  client.dispose();
}
