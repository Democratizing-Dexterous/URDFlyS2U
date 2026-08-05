import type { URDFRobot } from "../types";
import { parseURDF, type RobotParseResult, type URDFParseOptions } from "./URDFSerializer";
import { parseMJCF } from "./MJCFParser";
import { ForwardKinematics } from "./ForwardKinematics";
import { rotateInertialParams } from "./ZUpTransform";
import { apportionByVolume } from "./InertiaModel";

export type RobotFileFormat = "urdf" | "mjcf";

export interface RobotImportReport extends RobotParseResult {
  format: RobotFileFormat;
}

export const ROBOT_UNIT_SCALES: Record<string, number> = {
  m: 1000,
  mm: 1,
  cm: 10,
  inch: 25.4,
};

export function detectRobotFormat(text: string): RobotFileFormat | null {
  const root = new DOMParser()
    .parseFromString(text, "application/xml")
    .documentElement?.tagName?.toLowerCase();
  if (root === "robot") return "urdf";
  if (root === "mujoco") return "mjcf";
  if (/<\s*robot[\s>]/i.test(text)) return "urdf";
  if (/<\s*mujoco[\s>]/i.test(text)) return "mjcf";
  return null;
}

function normalizeInertialsToWorld(robot: URDFRobot): number {
  const withInertial = robot.links.filter((l) => l.inertial);
  if (withInertial.length === 0) return 0;

  const fk = new ForwardKinematics();
  fk.setRobot(robot);

  let count = 0;
  for (const link of withInertial) {
    const rest = fk.getLinkRestTransform(link.id);
    if (!rest) continue;
    link.inertial = rotateInertialParams(link.inertial!, rest);
    count++;
  }
  fk.dispose();
  return count;
}

export function parseRobotText(text: string, options?: URDFParseOptions): RobotImportReport {
  const format = detectRobotFormat(text);
  if (!format) {
    throw new Error("无法识别文件格式，需要包含 <robot>（URDF）或 <mujoco>（MJCF）根元素");
  }
  const result = format === "mjcf" ? parseMJCF(text, options) : parseURDF(text, options);
  normalizeInertialsToWorld(result.robot);
  return { ...result, format };
}

export function ensureBaseLink(robot: URDFRobot): void {
  if (robot.links.some((l) => l.name === "base_link")) return;

  const baseId = "link_base";
  const childIds = new Set(robot.joints.map((j) => j.childLinkId));
  const roots = robot.links.filter((l) => !childIds.has(l.id));

  robot.links.unshift({ id: baseId, name: "base_link", solidIds: [], inertial: null });

  let index = robot.joints.length;
  for (const root of roots) {
    robot.joints.unshift({
      id: `joint_base_${++index}`,
      name: `base_to_${root.name}`,
      type: "fixed",
      parentLinkId: baseId,
      childLinkId: root.id,
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
      axisOffset: [0, 0, 0],
      limits: { lower: 0, upper: 0, effort: 0, velocity: 0 },
      currentValue: 0,
    });
  }
}

export interface SolidRef {
  id: string;
  name: string;
}

export interface AutoBindResult {
  bound: number;
  matchedLinks: string[];
  unmatchedSolids: string[];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function autoBindSolidsByName(robot: URDFRobot, solids: SolidRef[]): AutoBindResult {
  const candidates = robot.links
    .map((link) => ({ link, key: normalize(link.name) }))
    .filter((entry) => entry.key.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  const matchedLinks = new Set<string>();
  const unmatchedSolids: string[] = [];
  let bound = 0;

  for (const solid of solids) {
    const key = normalize(solid.name);
    if (!key) {
      unmatchedSolids.push(solid.name);
      continue;
    }

    const hit =
      candidates.find((entry) => entry.key === key) ??
      candidates.find((entry) => key.includes(entry.key)) ??
      candidates.find((entry) => entry.key.includes(key));

    if (!hit) {
      unmatchedSolids.push(solid.name);
      continue;
    }

    if (!hit.link.solidIds.includes(solid.id)) {
      hit.link.solidIds.push(solid.id);
      bound++;
    }
    matchedLinks.add(hit.link.name);
  }

  return { bound, matchedLinks: [...matchedLinks], unmatchedSolids };
}

export function bindSolidsByLinkMap(
  robot: URDFRobot,
  linkSolidNames: Map<string, string[]>,
  solids: SolidRef[],
): AutoBindResult {
  const idByName = new Map<string, string[]>();
  for (const solid of solids) {
    const list = idByName.get(solid.name) ?? [];
    list.push(solid.id);
    idByName.set(solid.name, list);
  }

  const linkByName = new Map(robot.links.map((l) => [l.name, l]));
  const matchedLinks = new Set<string>();
  const unmatchedSolids: string[] = [];
  const consumed = new Set<string>();
  let bound = 0;

  for (const [linkName, names] of linkSolidNames) {
    const link = linkByName.get(linkName);
    if (!link) {
      unmatchedSolids.push(...names);
      continue;
    }

    for (const name of names) {
      const ids = idByName.get(name);
      if (!ids || ids.length === 0) {
        unmatchedSolids.push(name);
        continue;
      }
      const id = ids.find((candidate) => !consumed.has(candidate));
      if (!id) {
        unmatchedSolids.push(name);
        continue;
      }
      consumed.add(id);
      if (!link.solidIds.includes(id)) {
        link.solidIds.push(id);
        bound++;
      }
      matchedLinks.add(link.name);
    }
  }

  const leftovers = solids.filter((s) => !consumed.has(s.id));
  if (leftovers.length > 0) {
    const fallback = autoBindSolidsByName(robot, leftovers);
    bound += fallback.bound;
    fallback.matchedLinks.forEach((name) => matchedLinks.add(name));
    unmatchedSolids.push(...fallback.unmatchedSolids);
  }

  return { bound, matchedLinks: [...matchedLinks], unmatchedSolids };
}

export function clearRobotBindings(robot: URDFRobot): void {
  for (const link of robot.links) {
    link.solidIds = [];
    link.inertial = null;
    if (link.solidMasses) delete link.solidMasses;
  }
}

export interface RemapOptions {
  volumeById?: Map<string, number>;
}

export interface RemapResult {
  changedLinkIds: string[];
}

export function remapRobotSolidIds(
  robot: URDFRobot,
  mapping: Map<string, string[]>,
  options?: RemapOptions,
): RemapResult {
  const changedLinkIds: string[] = [];

  for (const link of robot.links) {
    const nextIds: string[] = [];
    const nextMasses: Record<string, number> = {};
    const previousMasses = link.solidMasses ?? {};
    let restructured = false;

    for (const oldId of link.solidIds) {
      const replacements = mapping.get(oldId);
      const targets = replacements ?? [oldId];
      const previous = previousMasses[oldId];
      const hasPrevious = typeof previous === "number" && previous > 0;

      if (targets.length > 1) {
        restructured = true;
        if (hasPrevious) {
          const volumes = targets.map((id) => ({
            solidId: id,
            volume: options?.volumeById?.get(id) ?? 0,
          }));
          const shares = apportionByVolume(volumes, previous);
          for (const id of targets) {
            if (!nextIds.includes(id)) nextIds.push(id);
            if (shares[id] > 0) nextMasses[id] = (nextMasses[id] ?? 0) + shares[id];
          }
          continue;
        }
      }

      for (const id of targets) {
        if (nextIds.includes(id)) restructured = true;
        else nextIds.push(id);
        if (hasPrevious) nextMasses[id] = (nextMasses[id] ?? 0) + previous;
      }
    }

    link.solidIds = nextIds;
    if (Object.keys(nextMasses).length > 0) link.solidMasses = nextMasses;
    else if (link.solidMasses) delete link.solidMasses;

    if (restructured) changedLinkIds.push(link.id);
  }

  return { changedLinkIds };
}
