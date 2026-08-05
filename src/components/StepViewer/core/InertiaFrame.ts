import * as THREE from "three";
import type { InertialParams, URDFRobot } from "../types";
import { ForwardKinematics } from "./ForwardKinematics";
import { rotateInertialParams, rotateTuple3 } from "./ZUpTransform";

export interface RestInverseOptions {
  baseLinkId?: string;
  baseLinkOrigin?: [number, number, number] | null;
  baseLinkRPY?: [number, number, number] | null;
}

export function basePoseInverse(options?: RestInverseOptions): THREE.Matrix4 | undefined {
  const origin = options?.baseLinkOrigin;
  const rpy = options?.baseLinkRPY;
  if (!origin && !rpy) return undefined;

  const o = origin ?? [0, 0, 0];
  const r = rpy ?? [0, 0, 0];
  const translation = new THREE.Matrix4().makeTranslation(o[0], o[1], o[2]);
  const rotation = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(r[0], r[1], r[2], "ZYX"),
  );
  return new THREE.Matrix4().multiplyMatrices(translation, rotation).invert();
}

export function buildLinkRestInverses(
  robot: URDFRobot,
  options?: RestInverseOptions,
): Map<string, THREE.Matrix4> {
  const fk = new ForwardKinematics();
  fk.setRobot(robot);

  const map = new Map<string, THREE.Matrix4>();
  for (const link of robot.links) {
    const rest = fk.getLinkRestTransform(link.id);
    if (rest) map.set(link.id, rest.invert());
  }
  fk.dispose();

  const baseInverse = basePoseInverse(options);
  if (baseInverse && options?.baseLinkId) map.set(options.baseLinkId, baseInverse);

  return map;
}

export function toLinkLocalInertial(
  inertial: InertialParams,
  restInverse?: THREE.Matrix4,
): InertialParams {
  return restInverse ? rotateInertialParams(inertial, restInverse) : inertial;
}

export function toLinkLocalPoint(
  point: readonly [number, number, number],
  restInverse?: THREE.Matrix4,
): [number, number, number] {
  return restInverse ? rotateTuple3(point, restInverse, true) : [point[0], point[1], point[2]];
}
