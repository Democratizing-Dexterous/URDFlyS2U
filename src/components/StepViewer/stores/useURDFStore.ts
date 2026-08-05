import { defineStore } from "pinia";
import { ref, shallowRef, computed } from "vue";
import * as THREE from "three";
import type {
  URDFRobot,
  URDFLink,
  URDFJoint,
  JointType,
  URDFOrigin,
  JointLimits,
  InertialParams,
  BindingModeState,
  JointWizardStep,
  LoopClosure,
  LoopConstraintType,
  ExportFormat,
  CollisionConfig,
  CollisionShape,
  CollisionConflict,
  CollisionMode,
} from "../types";
import { ForwardKinematics } from "../core/ForwardKinematics";
import { fitLinkShape, separateShapes, type LinkGeometryInput } from "../core/CollisionSimplifier";
import {
  autoBindSolidsByName,
  bindSolidsByLinkMap,
  clearRobotBindings,
  remapRobotSolidIds,
  type AutoBindResult,
  type RemapOptions,
  type RemapResult,
} from "../core/RobotImport";
import { renormalizeAfterRemoval } from "../core/InertiaModel";
import { useStepViewerStore } from "./useStepViewerStore";

const BASE_LINK_ID = "link_base";

let _nextLinkId = 1;
let _nextJointId = 1;
let _nextLoopId = 1;

export interface URDFTreeNode {
  id: string;
  label: string;
  nodeType: "link" | "joint";
  jointType?: JointType;
  solidCount: number;
  isBase: boolean;
  children: URDFTreeNode[];
}

export const useURDFStore = defineStore("urdf", () => {
  const robot = ref<URDFRobot>({
    name: "robot",
    links: [{ id: BASE_LINK_ID, name: "base_link", solidIds: [], inertial: null }],
    joints: [],
    loops: [],
  });

  const exportFormat = ref<ExportFormat>("both");
  const loopAnchorPickId = ref<string | null>(null);

  const exporting = ref(false);
  const exportProgress = ref("");

  const selectedLinkId = ref<string | null>(null);
  const selectedJointId = ref<string | null>(null);

  const bindingMode = ref<BindingModeState>({ active: false, targetLinkId: null });

  const jointWizardVisible = ref(false);
  const jointWizardStep = ref<JointWizardStep>("select-links");

  const edgePickEditJointId = ref<string | null>(null);

  const showFrames = ref(true);
  const urdfEditorVisible = ref(false);

  const linkWorldTransforms = shallowRef(new Map<string, THREE.Matrix4>());

  const axisHelperScale = ref<number>(1.0);

  const basePickMode = ref(false);
  const baseLinkOrigin = ref<[number, number, number] | null>(null);
  const baseLinkRPY = ref<[number, number, number] | null>(null);
  const totalMass = ref(10);
  const lockedSolidIds = ref<string[]>([]);

  function isSolidMassLocked(solidId: string): boolean {
    return lockedSolidIds.value.includes(solidId);
  }

  function setSolidMassLocked(solidId: string, locked: boolean): void {
    const has = lockedSolidIds.value.includes(solidId);
    if (locked && !has) lockedSolidIds.value = [...lockedSolidIds.value, solidId];
    else if (!locked && has)
      lockedSolidIds.value = lockedSolidIds.value.filter((id) => id !== solidId);
  }

  function clearSolidMassLocks(): void {
    lockedSolidIds.value = [];
  }

  const lockedSolidMassMap = computed(() => {
    const map = new Map<string, number>();
    for (const link of robot.value.links) {
      if (!link.solidMasses) continue;
      for (const solidId of lockedSolidIds.value) {
        const m = link.solidMasses[solidId];
        if (typeof m === "number" && m > 0) map.set(solidId, m);
      }
    }
    return map;
  });

  const collisionConfig = ref<CollisionConfig>({
    mode: "auto",
    margin: 0.5,
    sweepCheck: true,
    sweepSamples: 5,
    minScale: 0.35,
    visible: true,
    useForExport: true,
  });
  const collisionShapes = ref<CollisionShape[]>([]);
  const collisionConflicts = ref<CollisionConflict[]>([]);
  const collisionOverrides = ref<Record<string, CollisionMode>>({});

  const collisionShapeMap = computed(() => {
    const map = new Map<string, CollisionShape>();
    collisionShapes.value.forEach((s) => map.set(s.linkId, s));
    return map;
  });

  const linkMap = computed(() => {
    const map = new Map<string, URDFLink>();
    robot.value.links.forEach((l) => map.set(l.id, l));
    return map;
  });

  const jointMap = computed(() => {
    const map = new Map<string, URDFJoint>();
    robot.value.joints.forEach((j) => map.set(j.id, j));
    return map;
  });

  const linkByName = computed(() => {
    const map = new Map<string, URDFLink>();
    robot.value.links.forEach((l) => map.set(l.name, l));
    return map;
  });

  const childJointMap = computed(() => {
    const map = new Map<string, URDFJoint>();
    robot.value.joints.forEach((j) => map.set(j.childLinkId, j));
    return map;
  });

  const parentJointMap = computed(() => {
    const map = new Map<string, URDFJoint[]>();
    robot.value.joints.forEach((j) => {
      const list = map.get(j.parentLinkId) || [];
      list.push(j);
      map.set(j.parentLinkId, list);
    });
    return map;
  });

  const rootLinks = computed(() => {
    const childIds = new Set(robot.value.joints.map((j) => j.childLinkId));
    return robot.value.links.filter((l) => !childIds.has(l.id));
  });

  const leafLinks = computed(() => {
    const parentIds = new Set(robot.value.joints.map((j) => j.parentLinkId));
    return robot.value.links.filter((l) => !parentIds.has(l.id));
  });

  function buildLinkNode(linkId: string): URDFTreeNode {
    const link = linkMap.value.get(linkId);
    const childJoints = parentJointMap.value.get(linkId) || [];
    return {
      id: linkId,
      label: link?.name ?? linkId,
      nodeType: "link",
      solidCount: link?.solidIds.length ?? 0,
      isBase: isBaseLink(linkId),
      jointType: undefined,
      children: childJoints.map((j) => ({
        id: j.id,
        label: j.name,
        nodeType: "joint" as const,
        jointType: j.type,
        solidCount: 0,
        isBase: false,
        children: linkMap.value.has(j.childLinkId) ? [buildLinkNode(j.childLinkId)] : [],
      })),
    };
  }

  const treeData = computed<URDFTreeNode[]>(() => rootLinks.value.map((l) => buildLinkNode(l.id)));

  const activeJoints = computed(() => {
    return robot.value.joints.filter((j) => j.type !== "fixed");
  });

  const solidLinkMap = computed(() => {
    const map = new Map<string, string>();
    for (const link of robot.value.links) {
      for (const id of link.solidIds) map.set(id, link.id);
    }
    return map;
  });

  const boundSolidIds = computed(() => new Set(solidLinkMap.value.keys()));

  function isBaseLink(linkId: string): boolean {
    return linkId === BASE_LINK_ID;
  }

  function addLink(name?: string): URDFLink {
    const id = `link_${_nextLinkId++}`;
    const link: URDFLink = {
      id,
      name: name || `Link_${_nextLinkId - 1}`,
      solidIds: [],
      inertial: null,
    };
    robot.value.links.push(link);
    selectedLinkId.value = id;
    return link;
  }

  function removeLink(linkId: string): { ok: boolean; reason?: string } {
    if (isBaseLink(linkId)) {
      return { ok: false, reason: "base_link 不能被删除" };
    }
    robot.value.joints = robot.value.joints.filter(
      (j) => j.parentLinkId !== linkId && j.childLinkId !== linkId,
    );
    robot.value.links = robot.value.links.filter((l) => l.id !== linkId);
    if (selectedLinkId.value === linkId) {
      selectedLinkId.value = null;
    }
    return { ok: true };
  }

  function renameLink(linkId: string, newName: string): { ok: boolean; reason?: string } {
    const link = linkMap.value.get(linkId);
    if (!link) return { ok: false, reason: "连杆不存在" };
    const duplicate = robot.value.links.find((l) => l.id !== linkId && l.name === newName);
    if (duplicate) {
      return { ok: false, reason: `连杆名 "${newName}" 已被占用，请使用唯一名称` };
    }
    link.name = newName;
    return { ok: true };
  }

  function renameJoint(jointId: string, newName: string): { ok: boolean; reason?: string } {
    const joint = jointMap.value.get(jointId);
    if (!joint) return { ok: false, reason: "关节不存在" };
    const duplicate = robot.value.joints.find((j) => j.id !== jointId && j.name === newName);
    if (duplicate) {
      return { ok: false, reason: `关节名 "${newName}" 已被占用，请使用唯一名称` };
    }
    joint.name = newName;
    return { ok: true };
  }

  function findSolidOwner(solidId: string): URDFLink | null {
    return robot.value.links.find((l) => l.solidIds.includes(solidId)) ?? null;
  }

  function bindSolid(linkId: string, solidId: string): void {
    const link = linkMap.value.get(linkId);
    if (!link || link.solidIds.includes(solidId)) return;

    const owner = findSolidOwner(solidId);
    if (owner) unbindSolid(owner.id, solidId);

    link.solidIds.push(solidId);
    link.inertial = null;
    if (link.solidMasses) delete link.solidMasses;
  }

  function unbindSolid(linkId: string, solidId: string): void {
    const link = linkMap.value.get(linkId);
    if (!link) return;

    const previousMass = link.inertial?.mass ?? 0;
    const renormalized = renormalizeAfterRemoval(link, solidId, previousMass);

    link.solidIds = link.solidIds.filter((id) => id !== solidId);
    if (link.solidMasses) delete link.solidMasses[solidId];
    setSolidMassLocked(solidId, false);

    if (renormalized) {
      if (Object.keys(renormalized).length > 0) link.solidMasses = renormalized;
      else {
        delete link.solidMasses;
        link.inertial = null;
      }
    } else if (link.solidIds.length === 0) {
      link.inertial = null;
    }
  }

  function validateJoint(
    parentLinkId: string,
    childLinkId: string,
    excludeJointId?: string,
  ): string | null {
    if (parentLinkId === childLinkId) {
      return "父子连杆不能相同";
    }
    if (childLinkId === BASE_LINK_ID) {
      return "base_link 不能作为 Child（它是根连杆）";
    }
    const existing = robot.value.joints.find(
      (j) => j.childLinkId === childLinkId && j.id !== excludeJointId,
    );
    if (existing) {
      return `该连杆已作为 "${existing.name}" 的 Child，禁止构成运动学闭环`;
    }
    return null;
  }

  function addJoint(config: {
    name?: string;
    type: JointType;
    parentLinkId: string;
    childLinkId: string;
    origin: URDFOrigin;
    axis: [number, number, number];
    axisOffset?: [number, number, number];
    limits?: JointLimits;
  }): { ok: true; joint: URDFJoint } | { ok: false; reason: string } {
    const err = validateJoint(config.parentLinkId, config.childLinkId);
    if (err) return { ok: false, reason: err };

    const id = `joint_${_nextJointId++}`;
    const joint: URDFJoint = {
      id,
      name: config.name || `Joint_${_nextJointId - 1}`,
      type: config.type,
      parentLinkId: config.parentLinkId,
      childLinkId: config.childLinkId,
      origin: config.origin,
      axis: config.axis,
      axisOffset: config.axisOffset || [0, 0, 0],
      limits:
        config.limits ||
        (config.type === "prismatic"
          ? { lower: -100, upper: 100, effort: 100, velocity: 100 }
          : { lower: -3.14159, upper: 3.14159, effort: 10, velocity: 1 }),
      currentValue: 0,
    };
    robot.value.joints.push(joint);
    selectedJointId.value = id;
    return { ok: true, joint };
  }

  function removeJoint(jointId: string): void {
    robot.value.joints = robot.value.joints.filter((j) => j.id !== jointId);
    if (selectedJointId.value === jointId) {
      selectedJointId.value = null;
    }
  }

  function updateJoint(jointId: string, updates: Partial<Omit<URDFJoint, "id">>): void {
    const joint = jointMap.value.get(jointId);
    if (joint) {
      Object.assign(joint, updates);
    }
  }

  function setJointValue(jointId: string, value: number): void {
    const joint = jointMap.value.get(jointId);
    if (joint) {
      joint.currentValue = Math.max(joint.limits.lower, Math.min(joint.limits.upper, value));
    }
  }

  function setBallValue(jointId: string, value: [number, number, number]): void {
    const joint = jointMap.value.get(jointId);
    if (!joint) return;
    const limit = Math.max(Math.abs(joint.limits.lower), Math.abs(joint.limits.upper));
    joint.ballValue = value.map((v) => Math.max(-limit, Math.min(limit, v))) as [
      number,
      number,
      number,
    ];
  }

  function resetJoints(): void {
    robot.value.joints.forEach((j) => {
      j.currentValue = 0;
      if (j.ballValue) j.ballValue = [0, 0, 0];
    });
  }

  function randomizeJoints(): void {
    robot.value.joints.forEach((j) => {
      if (j.type === "fixed" || j.type === "floating") return;
      if (j.type === "ball") {
        const limit = Math.max(Math.abs(j.limits.lower), Math.abs(j.limits.upper));
        j.ballValue = [
          (Math.random() * 2 - 1) * limit,
          (Math.random() * 2 - 1) * limit,
          (Math.random() * 2 - 1) * limit,
        ];
        return;
      }
      j.currentValue = j.limits.lower + Math.random() * (j.limits.upper - j.limits.lower);
    });
  }

  function setLinkInertial(linkId: string, inertial: InertialParams): void {
    const link = linkMap.value.get(linkId);
    if (link) {
      link.inertial = inertial;
    }
  }

  function setLinkSolidMasses(linkId: string, masses: Record<string, number>): void {
    const link = linkMap.value.get(linkId);
    if (link) {
      link.solidMasses = { ...masses };
    }
  }

  function addLoop(config: {
    type: LoopConstraintType;
    linkAId: string;
    linkBId: string;
    anchor?: [number, number, number];
    name?: string;
  }): { ok: true; loop: LoopClosure } | { ok: false; reason: string } {
    if (config.linkAId === config.linkBId) {
      return { ok: false, reason: "闭链约束的两个连杆不能相同" };
    }
    const dup = robot.value.loops.find(
      (l) =>
        (l.linkAId === config.linkAId && l.linkBId === config.linkBId) ||
        (l.linkAId === config.linkBId && l.linkBId === config.linkAId),
    );
    if (dup) {
      return { ok: false, reason: `这两个连杆之间已存在约束 "${dup.name}"` };
    }
    const id = `loop_${_nextLoopId++}`;
    const loop: LoopClosure = {
      id,
      name: config.name || `loop_${_nextLoopId - 1}`,
      type: config.type,
      linkAId: config.linkAId,
      linkBId: config.linkBId,
      anchor: config.anchor || [0, 0, 0],
      solref: [0.02, 1],
      enabled: true,
    };
    robot.value.loops.push(loop);
    return { ok: true, loop };
  }

  function removeLoop(loopId: string): void {
    robot.value.loops = robot.value.loops.filter((l) => l.id !== loopId);
    if (loopAnchorPickId.value === loopId) loopAnchorPickId.value = null;
  }

  function updateLoop(loopId: string, updates: Partial<Omit<LoopClosure, "id">>): void {
    const loop = robot.value.loops.find((l) => l.id === loopId);
    if (loop) Object.assign(loop, updates);
  }

  function startBindingMode(linkId: string): void {
    bindingMode.value = { active: true, targetLinkId: linkId };
  }

  function stopBindingMode(): void {
    bindingMode.value = { active: false, targetLinkId: null };
  }

  function renameLinkId(target: URDFRobot, from: string, to: string): void {
    for (const link of target.links) {
      if (link.id === from) link.id = to;
    }
    for (const joint of target.joints) {
      if (joint.parentLinkId === from) joint.parentLinkId = to;
      if (joint.childLinkId === from) joint.childLinkId = to;
    }
    for (const loop of target.loops ?? []) {
      if (loop.linkAId === from) loop.linkAId = to;
      if (loop.linkBId === from) loop.linkBId = to;
    }
  }

  function normalizeBaseLinkId(target: URDFRobot, currentId: string): void {
    if (currentId === BASE_LINK_ID) return;
    if (target.links.some((l) => l.id === BASE_LINK_ID)) {
      renameLinkId(target, BASE_LINK_ID, `${BASE_LINK_ID}_alt`);
    }
    renameLinkId(target, currentId, BASE_LINK_ID);
  }

  function clearSolidBindings(): void {
    clearRobotBindings(robot.value);
    collisionShapes.value = [];
    collisionConflicts.value = [];
  }

  function remapSolidIds(mapping: Map<string, string[]>, options?: RemapOptions): RemapResult {
    const result = remapRobotSolidIds(robot.value, mapping, options);
    collisionShapes.value = [];
    collisionConflicts.value = [];
    return result;
  }

  function bindSolidsByName(solids: { id: string; name: string }[]): AutoBindResult {
    return autoBindSolidsByName(robot.value, solids);
  }

  function bindSolidsByLinkNames(
    linkSolidNames: Map<string, string[]>,
    solids: { id: string; name: string }[],
  ): AutoBindResult {
    return bindSolidsByLinkMap(robot.value, linkSolidNames, solids);
  }

  function importRobot(imported: URDFRobot): void {
    const named = imported.links.find((l) => l.name === "base_link");
    if (named) {
      normalizeBaseLinkId(imported, named.id);
    } else {
      imported.links.unshift({
        id: BASE_LINK_ID,
        name: "base_link",
        solidIds: [],
        inertial: null,
      });
    }
    if (!imported.loops) imported.loops = [];
    robot.value = imported;
    selectedLinkId.value = null;
    selectedJointId.value = null;
    baseLinkOrigin.value = null;
    basePickMode.value = false;
    _nextLinkId = imported.links.length + 1;
    _nextJointId = imported.joints.length + 1;
    _nextLoopId = imported.loops.length + 1;
  }

  function jointWorldAxes(): Map<string, [number, number, number][]> {
    const fk = new ForwardKinematics();
    fk.setRobot(robot.value);
    fk.compute();

    const result = new Map<string, [number, number, number][]>();
    const push = (linkId: string, axis: [number, number, number]) => {
      const list = result.get(linkId) || [];
      list.push(axis);
      result.set(linkId, list);
    };

    for (const joint of robot.value.joints) {
      const wm = fk.getJointWorldMatrix(joint.id);
      if (!wm) continue;
      const rot = new THREE.Matrix4().extractRotation(wm);
      const axis = new THREE.Vector3(...joint.axis).applyMatrix4(rot).normalize();
      const tuple: [number, number, number] = [axis.x, axis.y, axis.z];
      push(joint.parentLinkId, tuple);
      push(joint.childLinkId, tuple);
    }
    return result;
  }

  function buildDeltaConfigs(samples: number): Map<string, THREE.Matrix4>[] {
    const configs: Map<string, THREE.Matrix4>[] = [new Map()];
    if (samples < 2) return configs;

    const fk = new ForwardKinematics();
    const saved = robot.value.joints.map((j) => ({ v: j.currentValue, b: j.ballValue }));

    const restInverses = new Map<string, THREE.Matrix4>();
    fk.setRobot(robot.value);
    for (const link of robot.value.links) {
      const rest = fk.getLinkRestTransform(link.id);
      if (rest) restInverses.set(link.id, rest.clone().invert());
    }

    const capture = (): Map<string, THREE.Matrix4> => {
      fk.setRobot(robot.value);
      const world = fk.compute();
      const map = new Map<string, THREE.Matrix4>();
      for (const [linkId, m] of world) {
        const inv = restInverses.get(linkId);
        if (!inv) continue;
        map.set(linkId, new THREE.Matrix4().multiplyMatrices(m, inv));
      }
      return map;
    };

    for (const joint of robot.value.joints) {
      const range = jointSampleRange(joint);
      if (range.length === 0) continue;

      robot.value.joints.forEach((j) => {
        j.currentValue = 0;
        if (j.ballValue) j.ballValue = [0, 0, 0];
      });

      for (const value of pickSamples(range, samples)) {
        if (joint.type === "ball") {
          joint.ballValue = [value, value, value];
        } else {
          joint.currentValue = value;
        }
        configs.push(capture());
      }
    }

    robot.value.joints.forEach((j, i) => {
      j.currentValue = saved[i].v;
      if (saved[i].b) j.ballValue = saved[i].b;
    });
    return configs;
  }

  function jointSampleRange(joint: URDFJoint): [number, number] | [] {
    switch (joint.type) {
      case "revolute":
      case "prismatic":
      case "ball":
        return [joint.limits.lower, joint.limits.upper];
      case "continuous":
        return [-Math.PI, Math.PI];
      default:
        return [];
    }
  }

  function pickSamples(range: [number, number], count: number): number[] {
    const [lo, hi] = range;
    if (!(hi > lo)) return [lo];
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(lo + ((hi - lo) * i) / (count - 1));
    }
    return out;
  }

  function buildLinkInputs(): LinkGeometryInput[] {
    const stepStore = useStepViewerStore();
    const axes = jointWorldAxes();
    const inputs: LinkGeometryInput[] = [];

    for (const link of robot.value.links) {
      if (link.solidIds.length === 0) continue;
      const solids: LinkGeometryInput["solids"] = [];
      for (const solidId of link.solidIds) {
        const data = stepStore.solidMap.get(solidId)?.serializedData;
        if (data) solids.push({ positions: data.positions, indices: data.indices });
      }
      if (solids.length === 0) continue;
      inputs.push({
        linkId: link.id,
        solids,
        preferredAxes: axes.get(link.id) || [],
        mode: collisionOverrides.value[link.id] || collisionConfig.value.mode,
      });
    }
    return inputs;
  }

  function generateCollisionShapes(): { count: number; conflicts: CollisionConflict[] } {
    const inputs = buildLinkInputs();
    const shapes: CollisionShape[] = [];
    for (const input of inputs) {
      const shape = fitLinkShape(input);
      if (shape) shapes.push(shape);
    }

    const cfg = collisionConfig.value;
    const deltaConfigs = cfg.sweepCheck
      ? buildDeltaConfigs(cfg.sweepSamples)
      : [new Map<string, THREE.Matrix4>()];
    const result = separateShapes(shapes, {
      margin: cfg.margin,
      minScale: cfg.minScale,
      deltaConfigs,
      adjacentPairs: robot.value.joints.map(
        (j) => [j.parentLinkId, j.childLinkId] as [string, string],
      ),
    });

    collisionShapes.value = result.shapes;
    collisionConflicts.value = result.conflicts;
    return { count: result.shapes.length, conflicts: result.conflicts };
  }

  function setLinkCollisionMode(linkId: string, mode: CollisionMode): void {
    collisionOverrides.value = { ...collisionOverrides.value, [linkId]: mode };
  }

  function clearCollisionShapes(): void {
    collisionShapes.value = [];
    collisionConflicts.value = [];
  }

  function findOrphanLinks(): string[] {
    const childIds = new Set(robot.value.joints.map((j) => j.childLinkId));
    return robot.value.links
      .filter((l) => !isBaseLink(l.id) && !childIds.has(l.id))
      .map((l) => l.name);
  }

  function clearAll(): void {
    robot.value = {
      name: "robot",
      links: [{ id: BASE_LINK_ID, name: "base_link", solidIds: [], inertial: null }],
      joints: [],
      loops: [],
    };
    loopAnchorPickId.value = null;
    selectedLinkId.value = null;
    selectedJointId.value = null;
    bindingMode.value = { active: false, targetLinkId: null };
    jointWizardVisible.value = false;
    jointWizardStep.value = "select-links";
    edgePickEditJointId.value = null;
    baseLinkOrigin.value = null;
    baseLinkRPY.value = null;
    basePickMode.value = false;
    showFrames.value = true;
    axisHelperScale.value = 1.0;
    linkWorldTransforms.value = new Map();
    exporting.value = false;
    exportProgress.value = "";
    collisionShapes.value = [];
    collisionConflicts.value = [];
    collisionOverrides.value = {};
    _nextLinkId = 1;
    _nextJointId = 1;
    _nextLoopId = 1;
  }

  return {
    BASE_LINK_ID,

    robot,
    selectedLinkId,
    selectedJointId,
    bindingMode,
    jointWizardVisible,
    jointWizardStep,
    edgePickEditJointId,
    showFrames,
    urdfEditorVisible,
    exporting,
    exportProgress,
    linkWorldTransforms,
    axisHelperScale,
    basePickMode,
    baseLinkOrigin,
    baseLinkRPY,
    totalMass,
    lockedSolidIds,
    lockedSolidMassMap,
    isSolidMassLocked,
    setSolidMassLocked,
    clearSolidMassLocks,
    exportFormat,
    loopAnchorPickId,

    collisionConfig,
    collisionShapes,
    collisionConflicts,
    collisionOverrides,
    collisionShapeMap,

    linkMap,
    jointMap,
    linkByName,
    childJointMap,
    parentJointMap,
    rootLinks,
    leafLinks,
    activeJoints,
    boundSolidIds,
    solidLinkMap,
    treeData,

    isBaseLink,
    addLink,
    removeLink,
    renameLink,
    renameJoint,
    bindSolid,
    unbindSolid,
    findSolidOwner,

    validateJoint,
    addJoint,
    removeJoint,
    updateJoint,
    setJointValue,
    setBallValue,
    resetJoints,
    randomizeJoints,

    setLinkInertial,
    setLinkSolidMasses,

    addLoop,
    removeLoop,
    updateLoop,

    startBindingMode,
    stopBindingMode,

    findOrphanLinks,

    generateCollisionShapes,
    setLinkCollisionMode,
    clearCollisionShapes,

    importRobot,
    clearSolidBindings,
    remapSolidIds,
    bindSolidsByName,
    bindSolidsByLinkNames,
    clearAll,
  };
});
