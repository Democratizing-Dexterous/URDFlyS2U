import * as THREE from "three";
import type { URDFRobot, URDFJoint, URDFLink, CollisionShape } from "../types";
import { rotateInertiaTensor } from "./ZUpTransform";
import { escapeXml, fmtNum, fmtVec3, fmtVec4 } from "./xmlFormat";

export interface MJCFSerializeOptions {
  linkRestInverses?: Map<string, THREE.Matrix4>;
  unitScale?: number;
  basePoseInverse?: THREE.Matrix4;
  baseLinkId?: string;
  meshDir?: string;
  withActuators?: boolean;
  meshLinkNames?: Set<string>;
  collisionShapes?: Map<string, CollisionShape>;
}

export function serializeMJCF(robot: URDFRobot, options?: MJCFSerializeOptions): string {
  const s = options?.unitScale ?? 1;
  const meshDir = options?.meshDir ?? "meshes";
  const meshLinks =
    options?.meshLinkNames ??
    new Set(robot.links.filter((l) => l.solidIds.length > 0).map((l) => l.name));

  const linkById = new Map<string, URDFLink>();
  robot.links.forEach((l) => linkById.set(l.id, l));

  const childrenOf = new Map<string, URDFJoint[]>();
  const childIds = new Set<string>();
  for (const j of robot.joints) {
    const list = childrenOf.get(j.parentLinkId) || [];
    list.push(j);
    childrenOf.set(j.parentLinkId, list);
    childIds.add(j.childLinkId);
  }
  const rootLinks = robot.links.filter((l) => !childIds.has(l.id));

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<mujoco model="${escapeXml(robot.name)}">`);
  out.push('  <compiler angle="radian" autolimits="true" meshdir="' + escapeXml(meshDir) + '"/>');
  out.push('  <option integrator="implicitfast" timestep="0.002"/>');
  out.push("  <default>");
  out.push('    <geom contype="1" conaffinity="1" condim="3" friction="1 0.005 0.0001"/>');
  out.push('    <joint damping="0.1" armature="0.01"/>');
  out.push("  </default>");

  out.push("  <asset>");
  for (const name of meshLinks) {
    out.push(`    <mesh name="${escapeXml(name)}" file="${escapeXml(name)}.stl"/>`);
  }
  out.push("  </asset>");

  out.push("  <worldbody>");
  out.push('    <light pos="0 0 3" dir="0 0 -1" directional="true"/>');
  const identityPose = {
    xyz: [0, 0, 0] as [number, number, number],
    quat: [1, 0, 0, 0] as [number, number, number, number],
  };
  for (const root of rootLinks) {
    out.push(...serializeBody(root, identityPose, null, 2));
  }
  out.push("  </worldbody>");

  const equality = serializeEquality(robot, options, s, linkById);
  if (equality.length > 0) out.push(...equality);

  if (options?.withActuators !== false) {
    const actuators = serializeActuators(robot);
    if (actuators.length > 0) out.push(...actuators);
  }

  out.push("</mujoco>");
  return out.join("\n");

  function serializeBody(
    link: URDFLink,
    pose: { xyz: [number, number, number]; quat: [number, number, number, number] },
    incomingJoint: URDFJoint | null,
    depth: number,
  ): string[] {
    const pad = "  ".repeat(depth);
    const lines: string[] = [];

    lines.push(
      `${pad}<body name="${escapeXml(link.name)}" pos="${fmtVec3(pose.xyz)}" quat="${fmtVec4(pose.quat)}">`,
    );

    if (incomingJoint) {
      lines.push(...serializeJointTag(incomingJoint, pad + "  "));
    }

    lines.push(...serializeInertial(link, pad + "  "));

    const collision = options?.collisionShapes?.get(link.id);

    if (meshLinks.has(link.name)) {
      const visualAttrs = collision ? ' contype="0" conaffinity="0" group="2"' : "";
      lines.push(
        `${pad}  <geom type="mesh" mesh="${escapeXml(link.name)}" rgba="0.75 0.78 0.8 1"${visualAttrs}/>`,
      );
    }

    if (collision) {
      lines.push(`${pad}  ${collisionGeom(collision, link)}`);
    }

    for (const joint of childrenOf.get(link.id) || []) {
      const child = linkById.get(joint.childLinkId);
      if (!child) continue;
      lines.push(...serializeBody(child, jointPose(joint), joint, depth + 1));
    }

    lines.push(`${pad}</body>`);
    return lines;
  }

  function jointPose(joint: URDFJoint): {
    xyz: [number, number, number];
    quat: [number, number, number, number];
  } {
    const off = joint.axisOffset || [0, 0, 0];
    let xyz: [number, number, number] = [
      joint.origin.xyz[0] + off[0],
      joint.origin.xyz[1] + off[1],
      joint.origin.xyz[2] + off[2],
    ];
    let rot = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(joint.origin.rpy[0], joint.origin.rpy[1], joint.origin.rpy[2], "ZYX"),
    );

    if (options?.basePoseInverse && options.baseLinkId === joint.parentLinkId) {
      const bpi = options.basePoseInverse;
      xyz = applyMatrix(bpi, xyz);
      rot = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().extractRotation(bpi), rot);
    }

    const q = new THREE.Quaternion().setFromRotationMatrix(rot);
    return {
      xyz: [xyz[0] * s, xyz[1] * s, xyz[2] * s],
      quat: [q.w, q.x, q.y, q.z],
    };
  }

  function collisionGeom(shape: CollisionShape, link: URDFLink): string {
    const name = `${escapeXml(link.name)}_col`;

    const restInverse = options?.linkRestInverses?.get(link.id);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(shape.quat[0], shape.quat[1], shape.quat[2], shape.quat[3]),
    );
    m.setPosition(shape.center[0], shape.center[1], shape.center[2]);
    if (restInverse) m.premultiply(restInverse);

    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
    const pos = fmtVec3([p.x * s, p.y * s, p.z * s]);
    const quat = fmtVec4([q.w, q.x, q.y, q.z]);

    let type = "box";
    let size = fmtVec3([
      shape.halfExtents[0] * s,
      shape.halfExtents[1] * s,
      shape.halfExtents[2] * s,
    ]);

    if (shape.type === "sphere") {
      type = "sphere";
      size = fmtNum(shape.radius * s);
    } else if (shape.type === "cylinder") {
      type = "cylinder";
      size = `${fmtNum(shape.radius * s)} ${fmtNum((shape.height / 2) * s)}`;
    }

    return (
      `<geom name="${name}" type="${type}" size="${size}" pos="${pos}" quat="${quat}" ` +
      `group="3" rgba="0.2 0.8 0.4 0.4"/>`
    );
  }

  function serializeInertial(link: URDFLink, pad: string): string[] {
    if (!link.inertial) return [];
    const restInverse = options?.linkRestInverses?.get(link.id);

    let com = link.inertial.com as [number, number, number];
    if (restInverse) com = applyMatrix(restInverse, com);
    const comScaled: [number, number, number] = [com[0] * s, com[1] * s, com[2] * s];

    let inertia = link.inertial.inertia;
    if (restInverse) inertia = rotateInertiaTensor(inertia, restInverse);
    const [ixx, ixy, ixz, iyy, iyz, izz] = inertia;

    const mass = Math.max(link.inertial.mass, 1e-9);
    return [
      `${pad}<inertial pos="${fmtVec3(comScaled)}" mass="${fmtNum(mass)}" ` +
        `fullinertia="${fmtNum(ixx)} ${fmtNum(iyy)} ${fmtNum(izz)} ${fmtNum(ixy)} ${fmtNum(ixz)} ${fmtNum(iyz)}"/>`,
    ];
  }

  function serializeJointTag(joint: URDFJoint, pad: string): string[] {
    const name = escapeXml(joint.name);
    const axis = fmtVec3(joint.axis);
    const lim = joint.limits;

    switch (joint.type) {
      case "fixed":
        return [];
      case "floating":
        return [`${pad}<freejoint name="${name}"/>`];
      case "ball": {
        const maxAngle = Math.max(Math.abs(lim.lower), Math.abs(lim.upper));
        return [`${pad}<joint name="${name}" type="ball" range="0 ${fmtNum(maxAngle)}"/>`];
      }
      case "continuous":
        return [`${pad}<joint name="${name}" type="hinge" axis="${axis}" limited="false"/>`];
      case "revolute":
        return [
          `${pad}<joint name="${name}" type="hinge" axis="${axis}" range="${fmtNum(lim.lower)} ${fmtNum(lim.upper)}"/>`,
        ];
      case "prismatic":
        return [
          `${pad}<joint name="${name}" type="slide" axis="${axis}" ` +
            `range="${fmtNum(lim.lower * s)} ${fmtNum(lim.upper * s)}"/>`,
        ];
      case "planar": {
        const n = new THREE.Vector3(...joint.axis).normalize();
        const [t1, t2] = orthogonalBasis(n);
        return [
          `${pad}<joint name="${name}_tx" type="slide" axis="${fmtVec3([t1.x, t1.y, t1.z])}" ` +
            `range="${fmtNum(lim.lower * s)} ${fmtNum(lim.upper * s)}"/>`,
          `${pad}<joint name="${name}_ty" type="slide" axis="${fmtVec3([t2.x, t2.y, t2.z])}" ` +
            `range="${fmtNum(lim.lower * s)} ${fmtNum(lim.upper * s)}"/>`,
          `${pad}<joint name="${name}_rz" type="hinge" axis="${axis}" limited="false"/>`,
        ];
      }
      default:
        return [];
    }
  }

  function serializeEquality(
    r: URDFRobot,
    opts: MJCFSerializeOptions | undefined,
    scale: number,
    byId: Map<string, URDFLink>,
  ): string[] {
    const loops = (r.loops || []).filter((l) => l.enabled);
    if (loops.length === 0) return [];

    const lines: string[] = ["  <equality>"];
    for (const loop of loops) {
      const a = byId.get(loop.linkAId);
      const b = byId.get(loop.linkBId);
      if (!a || !b) continue;

      const solref = `solref="${fmtNum(loop.solref[0])} ${fmtNum(loop.solref[1])}"`;

      if (loop.type === "connect") {
        const invA = opts?.linkRestInverses?.get(a.id);
        let anchor = loop.anchor as [number, number, number];
        if (invA) anchor = applyMatrix(invA, anchor);
        const anchorScaled: [number, number, number] = [
          anchor[0] * scale,
          anchor[1] * scale,
          anchor[2] * scale,
        ];
        lines.push(
          `    <connect name="${escapeXml(loop.name)}" body1="${escapeXml(a.name)}" ` +
            `body2="${escapeXml(b.name)}" anchor="${fmtVec3(anchorScaled)}" ${solref}/>`,
        );
      } else {
        lines.push(
          `    <weld name="${escapeXml(loop.name)}" body1="${escapeXml(a.name)}" ` +
            `body2="${escapeXml(b.name)}" ${solref}/>`,
        );
      }
    }
    lines.push("  </equality>");
    return lines.length > 2 ? lines : [];
  }

  function serializeActuators(r: URDFRobot): string[] {
    const lines: string[] = ["  <actuator>"];
    for (const j of r.joints) {
      const name = escapeXml(j.name);
      const gear = Math.max(j.limits.effort, 1);
      if (j.type === "revolute" || j.type === "continuous") {
        lines.push(`    <position name="${name}_act" joint="${name}" kp="${fmtNum(gear)}"/>`);
      } else if (j.type === "prismatic") {
        lines.push(`    <position name="${name}_act" joint="${name}" kp="${fmtNum(gear)}"/>`);
      } else if (j.type === "planar") {
        lines.push(`    <position name="${name}_tx_act" joint="${name}_tx" kp="${fmtNum(gear)}"/>`);
        lines.push(`    <position name="${name}_ty_act" joint="${name}_ty" kp="${fmtNum(gear)}"/>`);
        lines.push(`    <position name="${name}_rz_act" joint="${name}_rz" kp="${fmtNum(gear)}"/>`);
      }
    }
    lines.push("  </actuator>");
    return lines.length > 2 ? lines : [];
  }
}

function orthogonalBasis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(ref, n).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  return [t1, t2];
}

function applyMatrix(m: THREE.Matrix4, v: [number, number, number]): [number, number, number] {
  const e = m.elements;
  return [
    e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12],
    e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13],
    e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14],
  ];
}
