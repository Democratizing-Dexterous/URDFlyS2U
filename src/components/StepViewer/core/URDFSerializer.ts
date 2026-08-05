import type {
  URDFRobot,
  URDFLink,
  URDFJoint,
  URDFOrigin,
  JointLimits,
  JointType,
  InertialParams,
  CollisionShape,
  LoopClosure,
  LoopConstraintType,
} from "../types";
import * as THREE from "three";
import { rotateInertiaTensor } from "./ZUpTransform";
import { escapeXml, fmtNum, fmtVec3, matrixToRPY, parseVec3 } from "./xmlFormat";

export interface SerializeOptions {
  linkRestInverses?: Map<string, THREE.Matrix4>;
  unitScale?: number;
  basePoseInverse?: THREE.Matrix4;
  baseLinkId?: string;
  collisionShapes?: Map<string, CollisionShape>;
}

export function serializeURDF(robot: URDFRobot, options?: SerializeOptions): string {
  const lines: string[] = [];
  const s = options?.unitScale ?? 1;
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<robot name="${escapeXml(robot.name)}">`);

  for (const link of robot.links) {
    const restInverse = options?.linkRestInverses?.get(link.id);
    lines.push(serializeLink(link, s, restInverse, options?.collisionShapes?.get(link.id)));
  }

  for (const joint of robot.joints) {
    lines.push(serializeJoint(joint, robot, s, options));
  }

  const loops = (robot.loops || []).filter((l) => l.enabled);
  if (loops.length > 0) {
    lines.push("  <!--");
    lines.push("    闭链约束（URDF 为树结构，无法原生表达，以下仅为记录；");
    lines.push("    完整闭链请使用同目录导出的 MuJoCo robot.xml 中的 <equality> 段）");
    for (const loop of loops) {
      const a = robot.links.find((l) => l.id === loop.linkAId)?.name || loop.linkAId;
      const b = robot.links.find((l) => l.id === loop.linkBId)?.name || loop.linkBId;
      const anchor: [number, number, number] = [
        loop.anchor[0] * s,
        loop.anchor[1] * s,
        loop.anchor[2] * s,
      ];
      lines.push(`    ${loop.name}: ${loop.type} ${a} <-> ${b} @ (${fmtVec3(anchor)})`);
    }
    lines.push("  -->");
  }

  lines.push("</robot>");
  return lines.join("\n");
}

function serializeLink(
  link: URDFLink,
  unitScale: number,
  restInverse?: THREE.Matrix4,
  collision?: CollisionShape,
): string {
  const lines: string[] = [];
  const s = unitScale;
  lines.push(`  <link name="${escapeXml(link.name)}">`);

  if (link.inertial) {
    let comLocal = link.inertial.com;
    if (restInverse) {
      const me = restInverse.elements;
      const [cx, cy, cz] = comLocal;
      comLocal = [
        me[0] * cx + me[4] * cy + me[8] * cz + me[12],
        me[1] * cx + me[5] * cy + me[9] * cz + me[13],
        me[2] * cx + me[6] * cy + me[10] * cz + me[14],
      ];
    }
    const comScaled: [number, number, number] = [comLocal[0] * s, comLocal[1] * s, comLocal[2] * s];

    let inertiaLocal = link.inertial.inertia as [number, number, number, number, number, number];
    if (restInverse) {
      inertiaLocal = rotateInertiaTensor(inertiaLocal, restInverse);
    }

    const [ixx, ixy, ixz, iyy, iyz, izz] = inertiaLocal;
    lines.push("    <inertial>");
    lines.push(`      <mass value="${fmtNum(link.inertial.mass)}"/>`);
    lines.push(`      <origin xyz="${fmtVec3(comScaled)}" rpy="0 0 0"/>`);
    lines.push(
      `      <inertia ixx="${fmtNum(ixx)}" ixy="${fmtNum(ixy)}" ixz="${fmtNum(ixz)}" iyy="${fmtNum(iyy)}" iyz="${fmtNum(iyz)}" izz="${fmtNum(izz)}"/>`,
    );
    lines.push("    </inertial>");
  } else {
    lines.push("    <inertial>");
    lines.push('      <mass value="0"/>');
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    lines.push('      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>');
    lines.push("    </inertial>");
  }

  if (link.solidIds.length > 0) {
    lines.push("    <visual>");
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    lines.push("      <geometry>");
    lines.push(`        <mesh filename="meshes/${escapeXml(link.name)}.stl"/>`);
    lines.push("      </geometry>");
    lines.push("    </visual>");

    lines.push("    <collision>");
    if (collision) {
      const pose = collisionPose(collision, s, restInverse);
      lines.push(`      <origin xyz="${fmtVec3(pose.xyz)}" rpy="${fmtVec3(pose.rpy)}"/>`);
      lines.push("      <geometry>");
      lines.push(`        ${collisionGeometryTag(collision, link.name, s)}`);
      lines.push("      </geometry>");
    } else {
      lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
      lines.push("      <geometry>");
      lines.push(`        <mesh filename="meshes/${escapeXml(link.name)}.stl"/>`);
      lines.push("      </geometry>");
    }
    lines.push("    </collision>");
  }

  lines.push("  </link>");
  return lines.join("\n");
}

function serializeJoint(
  joint: URDFJoint,
  robot: URDFRobot,
  unitScale: number,
  options?: SerializeOptions,
): string {
  const lines: string[] = [];
  const s = unitScale;
  const parentLink = robot.links.find((l) => l.id === joint.parentLinkId);
  const childLink = robot.links.find((l) => l.id === joint.childLinkId);
  const parentName = parentLink?.name || joint.parentLinkId;
  const childName = childLink?.name || joint.childLinkId;

  const isBaseChild =
    !!options?.basePoseInverse &&
    !!options?.baseLinkId &&
    joint.parentLinkId === options.baseLinkId;

  let xyzFinal = joint.origin.xyz as [number, number, number];
  let rpyFinal = joint.origin.rpy as [number, number, number];

  const axOff = joint.axisOffset || [0, 0, 0];
  xyzFinal = [xyzFinal[0] + axOff[0], xyzFinal[1] + axOff[1], xyzFinal[2] + axOff[2]];

  if (isBaseChild) {
    const bpi = options!.basePoseInverse!;
    const me = bpi.elements;
    const [ox, oy, oz] = xyzFinal;
    xyzFinal = [
      me[0] * ox + me[4] * oy + me[8] * oz + me[12],
      me[1] * ox + me[5] * oy + me[9] * oz + me[13],
      me[2] * ox + me[6] * oy + me[10] * oz + me[14],
    ];
    const rJoint = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(joint.origin.rpy[0], joint.origin.rpy[1], joint.origin.rpy[2], "ZYX"),
    );
    const rBpi = new THREE.Matrix4().extractRotation(bpi);
    const rCombined = new THREE.Matrix4().multiplyMatrices(rBpi, rJoint);
    rpyFinal = matrixToRPY(rCombined);
  }

  const xyzScaled: [number, number, number] = [xyzFinal[0] * s, xyzFinal[1] * s, xyzFinal[2] * s];

  if (joint.type === "ball") {
    const d1 = `${joint.name}_ball_x`;
    const d2 = `${joint.name}_ball_y`;
    lines.push(dummyLink(d1));
    lines.push(dummyLink(d2));
    lines.push(
      subRevolute(`${joint.name}_rx`, parentName, d1, xyzScaled, rpyFinal, [1, 0, 0], joint, s),
    );
    lines.push(subRevolute(`${joint.name}_ry`, d1, d2, [0, 0, 0], [0, 0, 0], [0, 1, 0], joint, s));
    lines.push(
      subRevolute(`${joint.name}_rz`, d2, childName, [0, 0, 0], [0, 0, 0], [0, 0, 1], joint, s),
    );
    return lines.join("\n");
  }

  lines.push(`  <joint name="${escapeXml(joint.name)}" type="${joint.type}">`);
  lines.push(`    <parent link="${escapeXml(parentName)}"/>`);
  lines.push(`    <child link="${escapeXml(childName)}"/>`);
  lines.push(`    <origin xyz="${fmtVec3(xyzScaled)}" rpy="${fmtVec3(rpyFinal)}"/>`);
  if (joint.type !== "floating") {
    lines.push(`    <axis xyz="${fmtVec3(joint.axis)}"/>`);
  }

  if (joint.type === "revolute" || joint.type === "prismatic") {
    lines.push(writeLimit(joint, s, true));
  } else if (joint.type === "continuous" || joint.type === "planar") {
    lines.push(writeLimit(joint, s, false));
  }

  lines.push("  </joint>");
  return lines.join("\n");
}

function writeLimit(joint: URDFJoint, unitScale: number, withRange: boolean): string {
  const isLinear = joint.type === "prismatic" || joint.type === "planar";
  const scale = isLinear ? unitScale : 1;
  const range = withRange
    ? `lower="${fmtNum(joint.limits.lower * scale)}" upper="${fmtNum(joint.limits.upper * scale)}" `
    : "";
  return `    <limit ${range}effort="${fmtNum(joint.limits.effort)}" velocity="${fmtNum(joint.limits.velocity * scale)}"/>`;
}

function dummyLink(name: string): string {
  return [
    `  <link name="${escapeXml(name)}">`,
    "    <inertial>",
    '      <mass value="1e-6"/>',
    '      <origin xyz="0 0 0" rpy="0 0 0"/>',
    '      <inertia ixx="1e-9" ixy="0" ixz="0" iyy="1e-9" iyz="0" izz="1e-9"/>',
    "    </inertial>",
    "  </link>",
  ].join("\n");
}

function subRevolute(
  name: string,
  parentName: string,
  childName: string,
  xyz: [number, number, number] | number[],
  rpy: [number, number, number] | number[],
  axis: [number, number, number],
  src: URDFJoint,
  unitScale: number,
): string {
  return [
    `  <joint name="${escapeXml(name)}" type="revolute">`,
    `    <parent link="${escapeXml(parentName)}"/>`,
    `    <child link="${escapeXml(childName)}"/>`,
    `    <origin xyz="${fmtVec3(xyz)}" rpy="${fmtVec3(rpy)}"/>`,
    `    <axis xyz="${fmtVec3(axis)}"/>`,
    writeLimit({ ...src, type: "revolute" }, unitScale, true),
    "  </joint>",
  ].join("\n");
}

export interface URDFParseOptions {
  unitScale?: number;
}

export interface RobotParseResult {
  robot: URDFRobot;
  warnings: string[];
}

export function parseURDF(xml: string, options?: URDFParseOptions): RobotParseResult {
  const s = options?.unitScale ?? 1;
  const warnings: string[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    throw new Error("URDF XML 解析失败: " + errorNode.textContent);
  }

  const robotEl = doc.querySelector("robot");
  if (!robotEl) {
    throw new Error("URDF XML 中未找到 <robot> 元素");
  }

  const robotName = robotEl.getAttribute("name") || "robot";
  const links: URDFLink[] = [];
  const joints: URDFJoint[] = [];

  const linkEls = robotEl.querySelectorAll(":scope > link");
  linkEls.forEach((el, idx) => {
    const name = el.getAttribute("name") || `Link_${idx + 1}`;
    const link: URDFLink = {
      id: `link_${idx + 1}`,
      name,
      solidIds: [],
      inertial: null,
    };

    const inertialEl = el.querySelector("inertial");
    if (inertialEl) {
      const inertial = parseInertial(inertialEl);
      link.inertial = {
        mass: inertial.mass,
        com: [inertial.com[0] * s, inertial.com[1] * s, inertial.com[2] * s],
        inertia: inertial.inertia,
      };
    }

    links.push(link);
  });

  const nameToId = new Map<string, string>();
  links.forEach((l) => nameToId.set(l.name, l.id));

  const jointEls = robotEl.querySelectorAll(":scope > joint");
  jointEls.forEach((el, idx) => {
    const name = el.getAttribute("name") || `Joint_${idx + 1}`;
    const rawType = el.getAttribute("type") || "fixed";
    const type = (KNOWN_JOINT_TYPES.has(rawType) ? rawType : "fixed") as JointType;
    if (!KNOWN_JOINT_TYPES.has(rawType)) {
      warnings.push(`关节 ${name} 的类型 "${rawType}" 不受支持，已按 fixed 处理`);
    }

    const parentName = el.querySelector("parent")?.getAttribute("link") || "";
    const childName = el.querySelector("child")?.getAttribute("link") || "";
    const origin = parseOrigin(el.querySelector("origin"));
    const axis = parseVec3(el.querySelector("axis")?.getAttribute("xyz") || "0 0 1");
    const limits = parseLimits(el.querySelector("limit"));

    if (el.querySelector("mimic")) {
      warnings.push(`关节 ${name} 含 <mimic>，本工具暂不支持联动，已忽略`);
    }

    const linear = type === "prismatic" || type === "planar";
    joints.push({
      id: `joint_${idx + 1}`,
      name,
      type,
      parentLinkId: nameToId.get(parentName) || parentName,
      childLinkId: nameToId.get(childName) || childName,
      origin: {
        xyz: [origin.xyz[0] * s, origin.xyz[1] * s, origin.xyz[2] * s],
        rpy: origin.rpy,
      },
      axis,
      limits: linear
        ? {
            lower: limits.lower * s,
            upper: limits.upper * s,
            effort: limits.effort,
            velocity: limits.velocity * s,
          }
        : limits,
      currentValue: 0,
      axisOffset: [0, 0, 0] as [number, number, number],
    });
  });

  mergeBallChains(links, joints, warnings);

  const loops = extractLoopComments(robotEl, links, s);
  const derived = splitClosureJoints(links, joints, warnings);
  loops.push(...derived);

  renumberIds(links, joints, loops);

  return { robot: { name: robotName, links, joints, loops }, warnings };
}

const KNOWN_JOINT_TYPES = new Set([
  "revolute",
  "continuous",
  "prismatic",
  "fixed",
  "floating",
  "planar",
  "ball",
]);

function mergeBallChains(links: URDFLink[], joints: URDFJoint[], warnings: string[]): void {
  const byName = new Map(joints.map((j) => [j.name, j]));
  const linkByName = new Map(links.map((l) => [l.name, l]));
  const removedJoints = new Set<string>();
  const removedLinks = new Set<string>();

  for (const joint of joints) {
    if (!joint.name.endsWith("_rx")) continue;
    const base = joint.name.slice(0, -3);
    const ry = byName.get(`${base}_ry`);
    const rz = byName.get(`${base}_rz`);
    const dummyX = linkByName.get(`${base}_ball_x`);
    const dummyY = linkByName.get(`${base}_ball_y`);
    if (!ry || !rz || !dummyX || !dummyY) continue;
    if (joint.childLinkId !== dummyX.id || ry.parentLinkId !== dummyX.id) continue;
    if (ry.childLinkId !== dummyY.id || rz.parentLinkId !== dummyY.id) continue;

    joint.name = base;
    joint.type = "ball";
    joint.childLinkId = rz.childLinkId;
    joint.axis = [0, 0, 1];
    joint.ballValue = [0, 0, 0];
    removedJoints.add(ry.id);
    removedJoints.add(rz.id);
    removedLinks.add(dummyX.id);
    removedLinks.add(dummyY.id);
    warnings.push(`已将 ${base}_rx/_ry/_rz 三段链合并为 ball 关节 ${base}`);
  }

  if (removedJoints.size === 0) return;
  for (let i = joints.length - 1; i >= 0; i--) {
    if (removedJoints.has(joints[i].id)) joints.splice(i, 1);
  }
  for (let i = links.length - 1; i >= 0; i--) {
    if (removedLinks.has(links[i].id)) links.splice(i, 1);
  }
}

function splitClosureJoints(
  links: URDFLink[],
  joints: URDFJoint[],
  warnings: string[],
): LoopClosure[] {
  const loops: LoopClosure[] = [];
  const seenChild = new Set<string>();
  const nameOf = new Map(links.map((l) => [l.id, l.name]));
  const worldPositions = computeWorldPositions(links, joints);

  for (let i = 0; i < joints.length; i++) {
    const joint = joints[i];
    if (!seenChild.has(joint.childLinkId)) {
      seenChild.add(joint.childLinkId);
      continue;
    }

    const parentWorld = worldPositions.get(joint.parentLinkId) ?? new THREE.Matrix4();
    const anchorWorld = new THREE.Vector3(
      joint.origin.xyz[0],
      joint.origin.xyz[1],
      joint.origin.xyz[2],
    ).applyMatrix4(parentWorld);

    loops.push({
      id: `loop_${loops.length + 1}`,
      name: joint.name || `loop_${loops.length + 1}`,
      type: joint.type === "fixed" ? "weld" : "connect",
      linkAId: joint.parentLinkId,
      linkBId: joint.childLinkId,
      anchor: [anchorWorld.x, anchorWorld.y, anchorWorld.z],
      solref: [0.02, 1],
      enabled: true,
    });
    warnings.push(
      `关节 ${joint.name} 使 ${nameOf.get(joint.childLinkId) ?? joint.childLinkId} 出现第二个父连杆，已转换为闭链约束`,
    );
    joints.splice(i, 1);
    i--;
  }

  return loops;
}

function computeWorldPositions(links: URDFLink[], joints: URDFJoint[]): Map<string, THREE.Matrix4> {
  const result = new Map<string, THREE.Matrix4>();
  const childIds = new Set(joints.map((j) => j.childLinkId));
  const jointsByParent = new Map<string, URDFJoint[]>();
  for (const joint of joints) {
    const list = jointsByParent.get(joint.parentLinkId) ?? [];
    list.push(joint);
    jointsByParent.set(joint.parentLinkId, list);
  }

  const queue: string[] = [];
  for (const link of links) {
    if (!childIds.has(link.id)) {
      result.set(link.id, new THREE.Matrix4());
      queue.push(link.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const base = result.get(current) ?? new THREE.Matrix4();
    for (const joint of jointsByParent.get(current) ?? []) {
      if (result.has(joint.childLinkId)) continue;
      const local = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(joint.origin.rpy[0], joint.origin.rpy[1], joint.origin.rpy[2], "ZYX"),
      );
      local.setPosition(joint.origin.xyz[0], joint.origin.xyz[1], joint.origin.xyz[2]);
      result.set(joint.childLinkId, new THREE.Matrix4().multiplyMatrices(base, local));
      queue.push(joint.childLinkId);
    }
  }

  return result;
}

function extractLoopComments(
  robotEl: Element,
  links: URDFLink[],
  unitScale: number,
): LoopClosure[] {
  const loops: LoopClosure[] = [];
  const idOfName = new Map(links.map((l) => [l.name, l.id]));

  robotEl.childNodes.forEach((node) => {
    if (node.nodeType !== 8) return;
    const text = node.textContent ?? "";
    const lineRe = /^\s*(\S+):\s*(connect|weld)\s+(\S+)\s*<->\s*(\S+)\s*@\s*\(([^)]*)\)\s*$/gim;
    let match: RegExpExecArray | null;
    while ((match = lineRe.exec(text)) !== null) {
      const linkAId = idOfName.get(match[3]);
      const linkBId = idOfName.get(match[4]);
      if (!linkAId || !linkBId) continue;
      const anchor = parseVec3(match[5].replace(/,/g, " "));
      loops.push({
        id: `loop_${loops.length + 1}`,
        name: match[1],
        type: match[2].toLowerCase() as LoopConstraintType,
        linkAId,
        linkBId,
        anchor: [anchor[0] * unitScale, anchor[1] * unitScale, anchor[2] * unitScale],
        solref: [0.02, 1],
        enabled: true,
      });
    }
  });

  return loops;
}

function renumberIds(links: URDFLink[], joints: URDFJoint[], loops: LoopClosure[]): void {
  const linkIdMap = new Map<string, string>();
  links.forEach((link, index) => {
    const next = `link_${index + 1}`;
    linkIdMap.set(link.id, next);
    link.id = next;
  });
  joints.forEach((joint, index) => {
    joint.id = `joint_${index + 1}`;
    joint.parentLinkId = linkIdMap.get(joint.parentLinkId) ?? joint.parentLinkId;
    joint.childLinkId = linkIdMap.get(joint.childLinkId) ?? joint.childLinkId;
  });
  loops.forEach((loop, index) => {
    loop.id = `loop_${index + 1}`;
    loop.linkAId = linkIdMap.get(loop.linkAId) ?? loop.linkAId;
    loop.linkBId = linkIdMap.get(loop.linkBId) ?? loop.linkBId;
  });
}

function collisionPose(
  shape: CollisionShape,
  unitScale: number,
  restInverse?: THREE.Matrix4,
): { xyz: [number, number, number]; rpy: [number, number, number] } {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(shape.quat[0], shape.quat[1], shape.quat[2], shape.quat[3]),
  );
  m.setPosition(shape.center[0], shape.center[1], shape.center[2]);
  if (restInverse) m.premultiply(restInverse);

  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  return {
    xyz: [pos.x * unitScale, pos.y * unitScale, pos.z * unitScale],
    rpy: matrixToRPY(new THREE.Matrix4().extractRotation(m)),
  };
}

function collisionGeometryTag(shape: CollisionShape, linkName: string, s: number): string {
  switch (shape.type) {
    case "box":
      return `<box size="${fmtVec3([
        shape.halfExtents[0] * 2 * s,
        shape.halfExtents[1] * 2 * s,
        shape.halfExtents[2] * 2 * s,
      ])}"/>`;
    case "sphere":
      return `<sphere radius="${fmtNum(shape.radius * s)}"/>`;
    case "cylinder":
      return `<cylinder radius="${fmtNum(shape.radius * s)}" length="${fmtNum(shape.height * s)}"/>`;
    default:
      return `<mesh filename="meshes/${escapeXml(linkName)}_collision.stl"/>`;
  }
}

function parseInertial(el: Element): InertialParams {
  const massEl = el.querySelector("mass");
  const mass = parseFloat(massEl?.getAttribute("value") || "0");

  const originEl = el.querySelector("origin");
  const com = parseVec3(originEl?.getAttribute("xyz") || "0 0 0") as [number, number, number];

  const inertiaEl = el.querySelector("inertia");
  const ixx = parseFloat(inertiaEl?.getAttribute("ixx") || "0");
  const ixy = parseFloat(inertiaEl?.getAttribute("ixy") || "0");
  const ixz = parseFloat(inertiaEl?.getAttribute("ixz") || "0");
  const iyy = parseFloat(inertiaEl?.getAttribute("iyy") || "0");
  const iyz = parseFloat(inertiaEl?.getAttribute("iyz") || "0");
  const izz = parseFloat(inertiaEl?.getAttribute("izz") || "0");

  return { mass, com, inertia: [ixx, ixy, ixz, iyy, iyz, izz] };
}

function parseOrigin(el: Element | null): URDFOrigin {
  if (!el) return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  return {
    xyz: parseVec3(el.getAttribute("xyz") || "0 0 0") as [number, number, number],
    rpy: parseVec3(el.getAttribute("rpy") || "0 0 0") as [number, number, number],
  };
}

function parseLimits(el: Element | null): JointLimits {
  if (!el) return { lower: -3.14159, upper: 3.14159, effort: 100, velocity: 1 };
  return {
    lower: parseFloat(el.getAttribute("lower") || "-3.14159"),
    upper: parseFloat(el.getAttribute("upper") || "3.14159"),
    effort: parseFloat(el.getAttribute("effort") || "100"),
    velocity: parseFloat(el.getAttribute("velocity") || "1"),
  };
}
