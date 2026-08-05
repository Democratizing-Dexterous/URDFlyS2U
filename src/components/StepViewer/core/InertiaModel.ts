import type { InertialParams, SerializedSolidData, SolidMassEntry, URDFLink } from "../types";
import { combineSolidInertia, computePerSolidInertia } from "./useInertiaWorker";

export interface SolidGeom {
  solidId: string;
  name: string;
  data: SerializedSolidData;
}

export interface SolidVolume {
  solidId: string;
  volume: number;
}

export interface LinkInertiaUpdate {
  inertial: InertialParams;
  solidMasses: Record<string, number>;
}

export function apportionByVolume(volumes: SolidVolume[], mass: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!(mass > 0) || volumes.length === 0) return out;

  const usable = volumes.filter((v) => Number.isFinite(v.volume) && v.volume > 0);
  if (usable.length === 0) {
    const even = mass / volumes.length;
    for (const v of volumes) out[v.solidId] = even;
    return out;
  }

  const total = usable.reduce((s, v) => s + v.volume, 0);
  let assigned = 0;
  for (let i = 0; i < usable.length; i++) {
    if (i === usable.length - 1) {
      out[usable[i].solidId] = mass - assigned;
      break;
    }
    const share = (usable[i].volume / total) * mass;
    out[usable[i].solidId] = share;
    assigned += share;
  }
  return out;
}

export function sumImportedMass(links: readonly URDFLink[]): number {
  let total = 0;
  for (const link of links) {
    if (link.inertial && link.inertial.mass > 0) total += link.inertial.mass;
  }
  return total;
}

export async function recomputeLinkInertial(
  link: URDFLink,
  geoms: SolidGeom[],
): Promise<LinkInertiaUpdate | null> {
  if (geoms.length === 0) return null;

  const results = await computePerSolidInertia(geoms.map((g) => g.data));
  if (results.length === 0) return null;

  const volumes: SolidVolume[] = results.map((r) => ({
    solidId: geoms[r.index].solidId,
    volume: r.volume,
  }));

  const recorded = link.solidMasses ?? {};
  const covered = volumes.every((v) => {
    const m = recorded[v.solidId];
    return typeof m === "number" && m > 0;
  });

  const targetMass = link.inertial?.mass ?? 0;
  const masses = covered
    ? Object.fromEntries(volumes.map((v) => [v.solidId, recorded[v.solidId]]))
    : apportionByVolume(volumes, targetMass);

  if (Object.keys(masses).length === 0) return null;

  const entries: SolidMassEntry[] = results.map((r) => {
    const solidId = geoms[r.index].solidId;
    return {
      solidId,
      name: geoms[r.index].name || r.name,
      volume: r.volume,
      mass: masses[solidId] ?? 0,
      com: r.com,
      refMass: r.refMass,
      inertiaAtCom: r.inertiaAtCom,
    };
  });

  const inertial = combineSolidInertia(entries);
  if (!(inertial.mass > 0)) return null;

  return {
    inertial,
    solidMasses: Object.fromEntries(
      entries.filter((e) => e.mass > 0).map((e) => [e.solidId, e.mass]),
    ),
  };
}

export function renormalizeAfterRemoval(
  link: URDFLink,
  removedSolidId: string,
  previousMass: number,
): Record<string, number> | null {
  if (!link.solidMasses) return null;
  const remaining = link.solidIds.filter((id) => id !== removedSolidId);
  if (remaining.length === 0) return {};

  const kept = remaining
    .map((id) => ({ id, mass: link.solidMasses![id] }))
    .filter((e) => typeof e.mass === "number" && e.mass > 0) as { id: string; mass: number }[];
  if (kept.length === 0) return null;

  const keptSum = kept.reduce((s, e) => s + e.mass, 0);
  if (!(previousMass > 0) || keptSum <= 0) return null;

  const k = previousMass / keptSum;
  return Object.fromEntries(kept.map((e) => [e.id, e.mass * k]));
}
