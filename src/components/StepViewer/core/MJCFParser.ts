import * as THREE from "three";
import type {
  URDFLink,
  URDFJoint,
  JointType,
  JointLimits,
  LoopClosure,
  InertialParams,
} from "../types";
import type { RobotParseResult, URDFParseOptions } from "./URDFSerializer";
import { rotateInertiaTensor } from "./ZUpTransform";
import { matrixToRPY, parseVec3 } from "./xmlFormat";

interface ParseContext {
  scale: number;
  angleScale: number;
  warnings: string[];
  links: URDFLink[];
  joints: URDFJoint[];
  worldMatrices: Map<string, THREE.Matrix4>;
  linkIdByBodyName: Map<string, string>;
  nextLink: number;
  nextJoint: number;
}

export function parseMJCF(xml: string, options?: URDFParseOptions): RobotParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    throw new Error("MJCF XML 解析失败: " + errorNode.textContent);
  }

  const root = doc.querySelector("mujoco");
  if (!root) {
    throw new Error("XML 中未找到 <mujoco> 元素");
  }

  const worldbody = directChildren(root, "worldbody")[0];
  if (!worldbody) {
    throw new Error("MJCF 中未找到 <worldbody> 元素");
  }

  const angleAttr = directChildren(root, "compiler")[0]?.getAttribute("angle") ?? "radian";
  const ctx: ParseContext = {
    scale: options?.unitScale ?? 1,
    angleScale: angleAttr.toLowerCase().startsWith("deg") ? Math.PI / 180 : 1,
    warnings: [],
    links: [],
    joints: [],
    worldMatrices: new Map(),
    linkIdByBodyName: new Map(),
    nextLink: 1,
    nextJoint: 1,
  };

  const baseLink: URDFLink = {
    id: `link_${ctx.nextLink++}`,
    name: "base_link",
    solidIds: [],
    inertial: null,
  };
  ctx.links.push(baseLink);
  ctx.worldMatrices.set(baseLink.id, new THREE.Matrix4());

  const topBodies = Array.from(worldbody.children).filter((el) => el.tagName === "body");
  for (const body of topBodies) {
    if (topBodies.length === 1 && body.getAttribute("name") === "base_link") {
      baseLink.inertial = readInertial(body, ctx);
      ctx.linkIdByBodyName.set("base_link", baseLink.id);
      for (const child of Array.from(body.children)) {
        if (child.tagName === "body") walkBody(child, baseLink.id, new THREE.Matrix4(), ctx);
      }
    } else {
      walkBody(body, baseLink.id, new THREE.Matrix4(), ctx);
    }
  }

  if (ctx.links.length === 1) {
    throw new Error("MJCF 中未找到任何 <body>");
  }

  const loops = parseEquality(root, ctx);

  return {
    robot: {
      name: root.getAttribute("model") || "robot",
      links: ctx.links,
      joints: ctx.joints,
      loops,
    },
    warnings: ctx.warnings,
  };
}

function walkBody(
  bodyEl: Element,
  parentLinkId: string,
  parentWorld: THREE.Matrix4,
  ctx: ParseContext,
): void {
  const bodyName = bodyEl.getAttribute("name") || `body_${ctx.nextLink}`;
  const local = bodyLocalMatrix(bodyEl, ctx);
  const world = new THREE.Matrix4().multiplyMatrices(parentWorld, local);

  const link: URDFLink = {
    id: `link_${ctx.nextLink++}`,
    name: bodyName,
    solidIds: [],
    inertial: readInertial(bodyEl, ctx),
  };
  ctx.links.push(link);
  ctx.linkIdByBodyName.set(bodyName, link.id);
  ctx.worldMatrices.set(link.id, world);

  const jointEls = Array.from(bodyEl.children).filter(
    (el) => el.tagName === "joint" || el.tagName === "freejoint",
  );

  const position = new THREE.Vector3().setFromMatrixPosition(local);
  const rpy = matrixToRPY(local);

  if (jointEls.length === 0) {
    pushJoint(ctx, {
      name: `${bodyName}_fixed`,
      type: "fixed",
      parentLinkId,
      childLinkId: link.id,
      xyz: [position.x, position.y, position.z],
      rpy,
      axis: [0, 0, 1],
      limits: defaultLimits("fixed"),
    });
  } else {
    let currentParent = parentLinkId;
    jointEls.forEach((jointEl, index) => {
      const isLast = index === jointEls.length - 1;
      let childId = link.id;
      if (!isLast) {
        const dummy: URDFLink = {
          id: `link_${ctx.nextLink++}`,
          name: `${bodyName}_dof${index + 1}`,
          solidIds: [],
          inertial: null,
        };
        ctx.links.push(dummy);
        ctx.worldMatrices.set(dummy.id, world);
        childId = dummy.id;
      }

      const parsed = readJoint(jointEl, bodyName, index, ctx);
      pushJoint(ctx, {
        name: parsed.name,
        type: parsed.type,
        parentLinkId: currentParent,
        childLinkId: childId,
        xyz: index === 0 ? [position.x, position.y, position.z] : [0, 0, 0],
        rpy: index === 0 ? rpy : [0, 0, 0],
        axis: parsed.axis,
        limits: parsed.limits,
      });
      currentParent = childId;
    });
  }

  for (const child of Array.from(bodyEl.children)) {
    if (child.tagName === "body") walkBody(child, link.id, world, ctx);
  }
}

function pushJoint(
  ctx: ParseContext,
  config: {
    name: string;
    type: JointType;
    parentLinkId: string;
    childLinkId: string;
    xyz: [number, number, number];
    rpy: [number, number, number];
    axis: [number, number, number];
    limits: JointLimits;
  },
): void {
  ctx.joints.push({
    id: `joint_${ctx.nextJoint++}`,
    name: config.name,
    type: config.type,
    parentLinkId: config.parentLinkId,
    childLinkId: config.childLinkId,
    origin: { xyz: config.xyz, rpy: config.rpy },
    axis: config.axis,
    axisOffset: [0, 0, 0],
    limits: config.limits,
    currentValue: 0,
  });
}

function readJoint(
  jointEl: Element,
  bodyName: string,
  index: number,
  ctx: ParseContext,
): { name: string; type: JointType; axis: [number, number, number]; limits: JointLimits } {
  const name = jointEl.getAttribute("name") || `${bodyName}_j${index + 1}`;
  const axis = parseVec3(jointEl.getAttribute("axis") || "0 0 1");
  const rawType =
    jointEl.tagName === "freejoint" ? "free" : jointEl.getAttribute("type") || "hinge";
  const range = jointEl.getAttribute("range");
  const limited = jointEl.getAttribute("limited");
  const hasRange = !!range && limited !== "false";
  const values = range ? parseVec3(`${range} 0`) : [0, 0, 0];

  switch (rawType) {
    case "slide": {
      const limits: JointLimits = hasRange
        ? {
            lower: values[0] * ctx.scale,
            upper: values[1] * ctx.scale,
            effort: 100,
            velocity: 100 * ctx.scale,
          }
        : {
            lower: -100 * ctx.scale,
            upper: 100 * ctx.scale,
            effort: 100,
            velocity: 100 * ctx.scale,
          };
      return { name, type: "prismatic", axis, limits };
    }
    case "ball": {
      const bound = hasRange
        ? Math.max(Math.abs(values[0]), Math.abs(values[1])) * ctx.angleScale
        : Math.PI;
      return {
        name,
        type: "ball",
        axis: [0, 0, 1],
        limits: { lower: -bound, upper: bound, effort: 10, velocity: 1 },
      };
    }
    case "free":
      return { name, type: "floating", axis: [0, 0, 1], limits: defaultLimits("floating") };
    case "hinge":
    default: {
      if (rawType !== "hinge") {
        ctx.warnings.push(`关节 ${name} 的 MuJoCo 类型 "${rawType}" 未识别，已按 hinge 处理`);
      }
      if (!hasRange) {
        return { name, type: "continuous", axis, limits: defaultLimits("continuous") };
      }
      return {
        name,
        type: "revolute",
        axis,
        limits: {
          lower: values[0] * ctx.angleScale,
          upper: values[1] * ctx.angleScale,
          effort: 10,
          velocity: 1,
        },
      };
    }
  }
}

function defaultLimits(type: JointType): JointLimits {
  if (type === "prismatic") return { lower: -100, upper: 100, effort: 100, velocity: 100 };
  return { lower: -Math.PI, upper: Math.PI, effort: 10, velocity: 1 };
}

function readInertial(bodyEl: Element, ctx: ParseContext): InertialParams | null {
  const el = Array.from(bodyEl.children).find((child) => child.tagName === "inertial");
  if (!el) return null;

  const mass = Number(el.getAttribute("mass") ?? "0") || 0;
  const pos = parseVec3(el.getAttribute("pos") || "0 0 0");
  const com: [number, number, number] = [
    pos[0] * ctx.scale,
    pos[1] * ctx.scale,
    pos[2] * ctx.scale,
  ];

  const full = el.getAttribute("fullinertia");
  if (full) {
    const v = full.trim().split(/\s+/).map(Number);
    return {
      mass,
      com,
      inertia: [v[0] || 0, v[3] || 0, v[4] || 0, v[1] || 0, v[5] || 0, v[2] || 0],
    };
  }

  const diag = el.getAttribute("diaginertia");
  if (diag) {
    const v = diag.trim().split(/\s+/).map(Number);
    const principal: [number, number, number, number, number, number] = [
      v[0] || 0,
      0,
      0,
      v[1] || 0,
      0,
      v[2] || 0,
    ];
    const frame = readOrientation(el, ctx);
    return { mass, com, inertia: frame ? rotateInertiaTensor(principal, frame) : principal };
  }

  return { mass, com, inertia: [0, 0, 0, 0, 0, 0] };
}

function readOrientation(el: Element, ctx: ParseContext): THREE.Matrix4 | null {
  const quatAttr = el.getAttribute("quat");
  const eulerAttr = el.getAttribute("euler");
  const axisAngleAttr = el.getAttribute("axisangle");

  const matrix = new THREE.Matrix4();

  if (quatAttr) {
    const q = quatAttr.trim().split(/\s+/).map(Number);
    matrix.makeRotationFromQuaternion(
      new THREE.Quaternion(q[1] || 0, q[2] || 0, q[3] || 0, q[0] ?? 1).normalize(),
    );
    return matrix;
  }
  if (eulerAttr) {
    const e = parseVec3(eulerAttr);
    matrix.makeRotationFromEuler(
      new THREE.Euler(e[0] * ctx.angleScale, e[1] * ctx.angleScale, e[2] * ctx.angleScale, "XYZ"),
    );
    return matrix;
  }
  if (axisAngleAttr) {
    const v = axisAngleAttr.trim().split(/\s+/).map(Number);
    const axis = new THREE.Vector3(v[0] || 0, v[1] || 0, v[2] || 1).normalize();
    matrix.makeRotationAxis(axis, (v[3] || 0) * ctx.angleScale);
    return matrix;
  }

  return null;
}

function bodyLocalMatrix(bodyEl: Element, ctx: ParseContext): THREE.Matrix4 {
  const pos = parseVec3(bodyEl.getAttribute("pos") || "0 0 0");
  const matrix = readOrientation(bodyEl, ctx) ?? new THREE.Matrix4();
  matrix.setPosition(pos[0] * ctx.scale, pos[1] * ctx.scale, pos[2] * ctx.scale);
  return matrix;
}

function directChildren(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((el) => el.tagName === tagName);
}

function parseEquality(root: Element, ctx: ParseContext): LoopClosure[] {
  const constraints = directChildren(root, "equality").flatMap((block) =>
    Array.from(block.children),
  );
  if (constraints.length === 0) return [];

  const loops: LoopClosure[] = [];
  for (const el of constraints) {
    if (el.tagName !== "connect" && el.tagName !== "weld") continue;
    const body1 = el.getAttribute("body1") || "";
    const body2 = el.getAttribute("body2") || "";
    const linkAId = ctx.linkIdByBodyName.get(body1);
    const linkBId = ctx.linkIdByBodyName.get(body2);
    if (!linkAId || !linkBId) {
      ctx.warnings.push(`约束 ${el.getAttribute("name") || el.tagName} 引用了未知 body，已跳过`);
      continue;
    }

    const anchorLocal = parseVec3(el.getAttribute("anchor") || "0 0 0");
    const anchorWorld = new THREE.Vector3(
      anchorLocal[0] * ctx.scale,
      anchorLocal[1] * ctx.scale,
      anchorLocal[2] * ctx.scale,
    ).applyMatrix4(ctx.worldMatrices.get(linkAId) ?? new THREE.Matrix4());

    const solrefAttr = el.getAttribute("solref");
    const solref = solrefAttr ? solrefAttr.trim().split(/\s+/).map(Number) : [0.02, 1];

    loops.push({
      id: `loop_${loops.length + 1}`,
      name: el.getAttribute("name") || `loop_${loops.length + 1}`,
      type: el.tagName === "weld" ? "weld" : "connect",
      linkAId,
      linkBId,
      anchor: [anchorWorld.x, anchorWorld.y, anchorWorld.z],
      solref: [solref[0] || 0.02, solref[1] || 1],
      enabled: true,
    });
  }

  return loops;
}
