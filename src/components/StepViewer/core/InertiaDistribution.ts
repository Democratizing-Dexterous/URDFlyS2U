import { computePerSolidInertia, combineSolidInertia } from "./useInertiaWorker";
import type { SerializedSolidData, SolidMassEntry, InertialParams } from "../types";

export interface LinkInertiaInput {
  linkId: string;
  name: string;
  pairs: { solidId: string; solidName?: string; data: SerializedSolidData }[];
}

export interface LinkInertiaResult {
  linkId: string;
  name: string;
  mass: number;
  com: [number, number, number];
  inertia: InertialParams["inertia"];
  solids: SolidMassEntry[];
}

export async function distributeInertia(
  inputs: LinkInertiaInput[],
  totalMass: number,
  fixedSolidMass?: Map<string, number>,
): Promise<LinkInertiaResult[]> {
  const valid = inputs.filter((i) => i.pairs.length > 0);
  if (valid.length === 0) return [];

  const flat: SerializedSolidData[] = [];
  const owner: LinkInertiaInput[] = [];
  const pairIndex: number[] = [];
  for (const input of valid) {
    input.pairs.forEach((pair, i) => {
      flat.push(pair.data);
      owner.push(input);
      pairIndex.push(i);
    });
  }

  const solidResults = await computePerSolidInertia(flat);

  const perLink = new Map<string, SolidMassEntry[]>();
  let totalVolume = 0;
  for (const r of solidResults) {
    if (r.refMass <= 0) continue;
    const input = owner[r.index];
    const pair = input.pairs[pairIndex[r.index]];
    const list = perLink.get(input.linkId) ?? [];
    list.push({
      solidId: pair.solidId,
      name: pair.solidName || r.name,
      volume: r.volume,
      mass: 0,
      com: r.com,
      refMass: r.refMass,
      inertiaAtCom: r.inertiaAtCom,
    });
    perLink.set(input.linkId, list);
    totalVolume += r.volume;
  }
  if (totalVolume <= 0) return [];

  let pinnedMass = 0;
  let unpinnedVolume = 0;
  for (const entries of perLink.values()) {
    for (const e of entries) {
      const fixed = fixedSolidMass?.get(e.solidId);
      if (fixed !== undefined && fixed > 0) pinnedMass += fixed;
      else unpinnedVolume += e.volume;
    }
  }

  const residual = totalMass - pinnedMass;
  if (residual < 0) {
    throw new Error(
      `锁定的 Solid 质量合计 ${pinnedMass.toFixed(3)} kg 已超过整机总质量 ${totalMass.toFixed(3)} kg`,
    );
  }

  const nameOf = new Map(valid.map((i) => [i.linkId, i.name]));
  const out: LinkInertiaResult[] = [];
  for (const [linkId, entries] of perLink) {
    for (const e of entries) {
      const fixed = fixedSolidMass?.get(e.solidId);
      if (fixed !== undefined && fixed > 0) {
        e.mass = fixed;
        e.locked = true;
      } else {
        e.mass = unpinnedVolume > 0 ? (e.volume / unpinnedVolume) * residual : 0;
      }
    }
    const combined = combineSolidInertia(entries);
    out.push({
      linkId,
      name: nameOf.get(linkId) ?? linkId,
      mass: combined.mass,
      com: combined.com,
      inertia: combined.inertia,
      solids: entries,
    });
  }
  return out;
}
