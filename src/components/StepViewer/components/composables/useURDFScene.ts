import * as THREE from "three";
import { ElMessage } from "element-plus";
import { FrameVisualizer } from "../../core/FrameVisualizer";
import { ForwardKinematics } from "../../core/ForwardKinematics";
import { JointSnapVisualizer } from "../../core/JointSnapVisualizer";
import { CollisionVisualizer } from "../../core/CollisionVisualizer";
import { computeRelativeTransform } from "../../core/useKinematicsWorker";
import { exportURDFInWorker, disposeExportWorker } from "../../core/useExportWorker";
import { serializeURDF } from "../../core/URDFSerializer";
import { serializeMJCF } from "../../core/MJCFSerializer";
import { distributeInertia, type LinkInertiaInput } from "../../core/InertiaDistribution";
import { buildLinkRestInverses, basePoseInverse } from "../../core/InertiaFrame";
import { useStepViewerStore } from "../../stores/useStepViewerStore";
import { useURDFStore } from "../../stores/useURDFStore";
import type { SceneManager, SelectionManager } from "../../core";
import type { FrameAxis } from "../../core/AxisFrame";
import type { AxisCandidate } from "../../core/AxisCandidate";
import { FeatureType } from "../../types";
import type { GeometryFeature, SnapData } from "../../types";

interface UseURDFSceneDeps {
  getSceneManager: () => SceneManager | null;
  getSelectionManager: () => SelectionManager | null;
}

export function useURDFScene(deps: UseURDFSceneDeps) {
  const store = useStepViewerStore();
  const urdfStore = useURDFStore();

  let frameVisualizer: FrameVisualizer | null = null;
  let forwardKinematics: ForwardKinematics | null = null;
  let snapVisualizer: JointSnapVisualizer | null = null;
  let collisionVisualizer: CollisionVisualizer | null = null;
  let baseAxisLength = 0.05;
  let edgePickMode = false;
  let currentSnapData: SnapData | null = null;
  let modelDiagonal = 1;
  let xrayActive = false;
  let savedOpacity = 1;
  const XRAY_OPACITY = 0.15;
  let appliedGizmo: {
    position: [number, number, number];
    direction: [number, number, number];
  } | null = null;

  function getFK(): ForwardKinematics | null {
    return forwardKinematics;
  }
  function isEdgePickMode(): boolean {
    return edgePickMode;
  }
  function getSnapData(): SnapData | null {
    return currentSnapData;
  }
  function getBaseAxisLength(): number {
    return baseAxisLength;
  }

  function initModules(): void {
    const sm = deps.getSceneManager();
    if (!sm) return;

    const box = new THREE.Box3().setFromObject(sm.modelGroup);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    modelDiagonal = size.length() || maxDim || 1;
    baseAxisLength = maxDim > 0 ? maxDim * 0.05 : 0.05;
    const axisLength = baseAxisLength * urdfStore.axisHelperScale;

    frameVisualizer?.dispose();
    frameVisualizer = new FrameVisualizer({ scene: sm.scene, axisLength });

    if (!forwardKinematics) {
      forwardKinematics = new ForwardKinematics();
    }

    snapVisualizer?.dispose();
    snapVisualizer = new JointSnapVisualizer({ scene: sm.scene, axisLength });

    collisionVisualizer?.dispose();
    collisionVisualizer = new CollisionVisualizer({ scene: sm.scene });
    collisionVisualizer.setVisible(urdfStore.collisionConfig.visible);

    forwardKinematics.setRobot(urdfStore.robot);
    frameVisualizer.setVisible(urdfStore.showFrames);
    updateFKAndFrames();
  }

  function updateFKAndFrames(): void {
    const sm = deps.getSceneManager();
    if (!forwardKinematics || !sm) return;

    forwardKinematics.setRobot(urdfStore.robot);
    const transforms = forwardKinematics.compute();

    urdfStore.linkWorldTransforms = transforms;
    forwardKinematics.applyToScene(transforms, urdfStore.robot.links, store.solidMap);

    if (frameVisualizer && urdfStore.showFrames) {
      frameVisualizer.showAllFrames(urdfStore.robot.joints);
      for (const joint of urdfStore.robot.joints) {
        const wm = forwardKinematics.getJointWorldMatrix(joint.id);
        if (wm) frameVisualizer.updateFrameTransform(joint.id, wm);
      }
      frameVisualizer.showBaseFrame(urdfStore.baseLinkOrigin, urdfStore.baseLinkRPY ?? undefined);
    }

    if (collisionVisualizer && urdfStore.collisionShapes.length > 0) {
      collisionVisualizer.updateTransforms(urdfStore.collisionShapes, buildLinkDeltas(transforms));
    }

    sm.markDirty();
  }

  function buildLinkDeltas(transforms: Map<string, THREE.Matrix4>): Map<string, THREE.Matrix4> {
    const deltas = new Map<string, THREE.Matrix4>();
    if (!forwardKinematics) return deltas;
    for (const [linkId, world] of transforms) {
      const rest = forwardKinematics.getLinkRestTransform(linkId);
      if (!rest) continue;
      deltas.set(linkId, new THREE.Matrix4().multiplyMatrices(world, rest.invert()));
    }
    return deltas;
  }

  function refreshCollisionVisual(): void {
    if (!collisionVisualizer) return;
    collisionVisualizer.setShapes(urdfStore.collisionShapes);
    collisionVisualizer.setVisible(urdfStore.collisionConfig.visible);
    if (forwardKinematics) {
      collisionVisualizer.updateTransforms(
        urdfStore.collisionShapes,
        buildLinkDeltas(urdfStore.linkWorldTransforms),
      );
    }
    deps.getSceneManager()?.markDirty();
  }

  function setCollisionVisible(visible: boolean): void {
    collisionVisualizer?.setVisible(visible);
    deps.getSceneManager()?.markDirty();
  }

  async function fillMissingLinkInertials(): Promise<number> {
    const missing = new Set(
      urdfStore.robot.links.filter((l) => !l.inertial && l.solidIds.length > 0).map((l) => l.id),
    );
    if (missing.size === 0) return 0;

    const inputs: LinkInertiaInput[] = [];
    for (const link of urdfStore.robot.links) {
      if (link.solidIds.length === 0) continue;
      const pairs: LinkInertiaInput["pairs"] = [];
      for (const solidId of link.solidIds) {
        const solid = store.solidMap.get(solidId);
        if (solid?.serializedData) {
          pairs.push({ solidId, solidName: solid.name, data: solid.serializedData });
        }
      }
      if (pairs.length > 0) inputs.push({ linkId: link.id, name: link.name, pairs });
    }
    if (inputs.length === 0) return 0;

    const locked = urdfStore.lockedSolidMassMap;
    const results = await distributeInertia(
      inputs,
      urdfStore.totalMass,
      locked.size > 0 ? locked : undefined,
    );
    let filled = 0;
    for (const row of results) {
      if (!missing.has(row.linkId) || row.mass <= 0) continue;
      urdfStore.setLinkInertial(row.linkId, {
        mass: row.mass,
        com: row.com,
        inertia: row.inertia,
      });
      urdfStore.setLinkSolidMasses(
        row.linkId,
        Object.fromEntries(row.solids.map((s) => [s.solidId, s.mass])),
      );
      filled++;
    }
    return filled;
  }

  function disposeModules(): void {
    frameVisualizer?.dispose();
    frameVisualizer = null;
    snapVisualizer?.dispose();
    snapVisualizer = null;
    collisionVisualizer?.dispose();
    collisionVisualizer = null;
    forwardKinematics = null;
    currentSnapData = null;
    appliedGizmo = null;
    edgePickMode = false;
    disposeExportWorker();
  }

  function setFrameVisible(visible: boolean): void {
    frameVisualizer?.setVisible(visible);
  }

  function setAxisLength(scale: number): void {
    if (frameVisualizer) {
      frameVisualizer.setAxisLength(baseAxisLength * scale);
      deps.getSceneManager()?.markDirty();
    }
  }

  function handleHoverSnap(feature: GeometryFeature | null): void {
    const sm = deps.getSceneManager();
    if (!edgePickMode || !snapVisualizer) {
      snapVisualizer?.hide();
      currentSnapData = null;
      return;
    }

    if (!feature) {
      restoreAppliedGizmo();
      currentSnapData = null;
      sm?.markDirty();
      return;
    }

    const resolved = resolveSnapFromFeature(feature);
    if (!resolved) {
      restoreAppliedGizmo();
      currentSnapData = null;
      sm?.markDirty();
      return;
    }

    snapVisualizer.updateSnap(resolved.position, resolved.direction);
    snapVisualizer.showAxisLine(modelDiagonal * 0.6);
    currentSnapData = {
      position: [resolved.position.x, resolved.position.y, resolved.position.z],
      normal: [resolved.direction.x, resolved.direction.y, resolved.direction.z],
      featureType: resolved.featureType,
      frame: snapVisualizer.getCurrentFrame(),
    };
    sm?.markDirty();
  }

  function resolveSnapFromFeature(feature: GeometryFeature): {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    featureType: "circle" | "arc" | "line";
  } | null {
    const curve = feature.edgeCurveType;

    if (curve === "line") {
      if (!feature.startPoint || !feature.endPoint) return null;
      return {
        position: feature.startPoint.clone(),
        direction: feature.endPoint.clone().sub(feature.startPoint).normalize(),
        featureType: "line",
      };
    }

    if (curve === "circle" || curve === "arc") {
      const axis = feature.axis || feature.normal;
      if (!feature.center || !axis) return null;
      return {
        position: feature.center.clone(),
        direction: axis.clone().normalize(),
        featureType: curve,
      };
    }

    if (
      feature.type === FeatureType.CYLINDER ||
      feature.type === FeatureType.CONE ||
      feature.type === FeatureType.ARC ||
      feature.type === FeatureType.TORUS
    ) {
      const axis = feature.axis || feature.normal;
      if (!feature.center || !axis) return null;
      return {
        position: feature.center.clone(),
        direction: axis.clone().normalize(),
        featureType: "circle",
      };
    }

    return null;
  }

  function restoreAppliedGizmo(): void {
    if (!snapVisualizer) return;
    if (!appliedGizmo) {
      snapVisualizer.hide();
      return;
    }
    snapVisualizer.updateSnap(
      new THREE.Vector3(...appliedGizmo.position),
      new THREE.Vector3(...appliedGizmo.direction),
    );
    snapVisualizer.showAxisLine(modelDiagonal * 0.6);
  }

  function previewAxisCandidate(candidate: AxisCandidate | null, t?: number): void {
    const sm = deps.getSceneManager();
    if (!snapVisualizer) return;

    if (!candidate) {
      restoreAppliedGizmo();
      sm?.markDirty();
      return;
    }

    const offset = t ?? candidate.originT;
    const pos = new THREE.Vector3(
      candidate.basePoint[0] + candidate.dir[0] * offset,
      candidate.basePoint[1] + candidate.dir[1] * offset,
      candidate.basePoint[2] + candidate.dir[2] * offset,
    );
    const dir = new THREE.Vector3(candidate.dir[0], candidate.dir[1], candidate.dir[2]);

    snapVisualizer.updateSnap(pos, dir);
    snapVisualizer.showAxisLine(modelDiagonal * 0.6);
    sm?.markDirty();
  }

  function showAxisGizmo(
    position: [number, number, number],
    direction: [number, number, number],
  ): void {
    if (!snapVisualizer) return;
    appliedGizmo = { position: [...position], direction: [...direction] };
    snapVisualizer.updateSnap(
      new THREE.Vector3(position[0], position[1], position[2]),
      new THREE.Vector3(direction[0], direction[1], direction[2]),
    );
    snapVisualizer.showAxisLine(modelDiagonal * 0.6);
    deps.getSceneManager()?.markDirty();
  }

  function hideAxisGizmo(): void {
    appliedGizmo = null;
    snapVisualizer?.hide();
    deps.getSceneManager()?.markDirty();
  }

  function cycleAxisCandidate(step = 1): void {
    if (!edgePickMode) return;
    deps.getSelectionManager()?.cycleAxisCandidate(step);
  }

  function setXray(active: boolean): void {
    const sm = deps.getSelectionManager();

    if (active) {
      if (!xrayActive) savedOpacity = store.globalOpacity;
      xrayActive = true;
      const target = Math.min(savedOpacity, XRAY_OPACITY);
      store.setGlobalOpacity(target);
      store.setTransparent(target < 1);
      sm?.setOpacity(null, target);
    } else {
      if (!xrayActive) return;
      xrayActive = false;
      store.setGlobalOpacity(savedOpacity);
      store.setTransparent(savedOpacity < 1);
      sm?.setOpacity(null, savedOpacity);
    }

    deps.getSceneManager()?.markDirty();
  }

  function syncOpacityBaseline(opacity: number): void {
    if (!xrayActive) return;
    savedOpacity = opacity;
  }

  function isXrayActive(): boolean {
    return xrayActive;
  }

  function flipAxis(axis: FrameAxis): void {
    if (!snapVisualizer?.isVisible()) return;
    snapVisualizer.flipAxis(axis);
    if (currentSnapData) {
      const f = snapVisualizer.getCurrentFrame();
      currentSnapData.normal = [...f.z] as [number, number, number];
      currentSnapData.frame = f;
    }
    deps.getSceneManager()?.markDirty();
  }

  function handleBindingClick(feature: GeometryFeature): void {
    const targetLinkId = urdfStore.bindingMode.targetLinkId;
    if (!urdfStore.bindingMode.active || !targetLinkId) return;
    if (!feature.solidId) return;

    const owner = urdfStore.findSolidOwner(feature.solidId);
    if (owner && owner.id === targetLinkId) {
      urdfStore.unbindSolid(targetLinkId, feature.solidId);
      updateFKAndFrames();
      ElMessage.info("已从当前 Link 解绑该 Solid");
      return;
    }

    urdfStore.bindSolid(targetLinkId, feature.solidId);
    updateFKAndFrames();
    if (owner) {
      const target = urdfStore.linkMap.get(targetLinkId);
      ElMessage.success(`已从「${owner.name}」改绑到「${target?.name ?? targetLinkId}」`);
    }
  }

  function startEdgePickMode(): void {
    edgePickMode = true;
    deps.getSelectionManager()?.setGranularityMode("edge");
  }

  function stopEdgePickMode(): void {
    edgePickMode = false;
    urdfStore.edgePickEditJointId = null;
    appliedGizmo = null;
    snapVisualizer?.hide();
    currentSnapData = null;
    if (xrayActive) setXray(false);
    deps.getSelectionManager()?.setGranularityMode("solid");
    deps.getSceneManager()?.markDirty();
  }

  async function applyPickedEdgeToExistingJoint(
    jointId: string,
    feature: GeometryFeature,
  ): Promise<void> {
    const joint = urdfStore.jointMap.get(jointId);
    if (!joint) return;

    let snapPos: [number, number, number];
    let snapNorm: [number, number, number];

    if (feature.edgeCurveType === "line") {
      if (!feature.startPoint || !feature.endPoint) return;
      const dir = feature.endPoint.clone().sub(feature.startPoint).normalize();
      snapPos = [feature.startPoint.x, feature.startPoint.y, feature.startPoint.z];
      snapNorm = [dir.x, dir.y, dir.z];
    } else {
      if (!feature.center || (!feature.axis && !feature.normal)) return;
      const norm = (feature.axis || feature.normal)!;
      snapPos = [feature.center.x, feature.center.y, feature.center.z];
      snapNorm = [norm.x, norm.y, norm.z];
    }

    const parentWorld = urdfStore.linkWorldTransforms.get(joint.parentLinkId);
    const parentElements = parentWorld ? parentWorld.elements : new THREE.Matrix4().elements;

    const result = await computeRelativeTransform(parentElements, snapPos, snapNorm);

    joint.origin.xyz = result.xyz;
    joint.origin.rpy = result.rpy;
    joint.axis = [0, 0, 1];

    ElMessage.success("已更新关节参数");
  }

  function handleJointCreated(): void {
    urdfStore.showFrames = true;
    appliedGizmo = null;
    snapVisualizer?.hide();
    currentSnapData = null;
    updateFKAndFrames();
  }

  async function handleExportURDF(exportCompleteAdVisible: { value: boolean }): Promise<void> {
    const orphans = urdfStore.findOrphanLinks();
    if (orphans.length > 0) {
      ElMessage.warning(`以下 Link 未被任何 Joint 连接: ${orphans.join(", ")}`);
    }

    const nameCounts = new Map<string, number>();
    for (const link of urdfStore.robot.links) {
      nameCounts.set(link.name, (nameCounts.get(link.name) ?? 0) + 1);
    }
    const duplicateNames = [...nameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([n]) => n);
    if (duplicateNames.length > 0) {
      ElMessage.error(
        `存在重复的连杆名称，会导致 URDF/MJCF 无法加载: ${duplicateNames.join(", ")}`,
      );
      return;
    }

    urdfStore.exporting = true;
    urdfStore.exportProgress = "正在生成 URDF...";

    const savedValues = urdfStore.robot.joints.map((j) => j.currentValue);
    urdfStore.robot.joints.forEach((j) => {
      j.currentValue = 0;
    });

    try {
      const autoFilled = await fillMissingLinkInertials();
      if (autoFilled > 0) {
        ElMessage.info(
          `${autoFilled} 个连杆未设置惯性参数，已按整机总质量 ${urdfStore.totalMass} kg 自动分配`,
        );
      }

      const restOptions = {
        baseLinkId: urdfStore.BASE_LINK_ID,
        baseLinkOrigin: urdfStore.baseLinkOrigin,
        baseLinkRPY: urdfStore.baseLinkRPY,
      };
      const linkRestInverses = buildLinkRestInverses(urdfStore.robot, restOptions);
      const basePoseInverseForExport = basePoseInverse(restOptions);

      const format = urdfStore.exportFormat;
      const useCollision =
        urdfStore.collisionConfig.useForExport && urdfStore.collisionShapes.length > 0;
      const collisionShapeMap = useCollision
        ? new Map(urdfStore.collisionShapes.map((s) => [s.linkId, s]))
        : undefined;

      const serializeOptions = {
        linkRestInverses,
        unitScale: 0.001,
        basePoseInverse: basePoseInverseForExport,
        baseLinkId: urdfStore.BASE_LINK_ID,
        collisionShapes: collisionShapeMap,
      };

      const urdfXml = format === "mjcf" ? "" : serializeURDF(urdfStore.robot, serializeOptions);

      const linkSolidMap: Record<string, import("../../types").SerializedSolidData[]> = {};
      const linkRestInverseMap: Record<string, number[]> = {};

      for (const link of urdfStore.robot.links) {
        if (link.solidIds.length === 0) continue;
        const solidDataList: import("../../types").SerializedSolidData[] = [];
        for (const solidId of link.solidIds) {
          const solid = store.solidMap.get(solidId);
          if (solid?.serializedData) solidDataList.push(solid.serializedData);
        }
        if (solidDataList.length > 0) {
          linkSolidMap[link.name] = solidDataList;
          const inv = linkRestInverses.get(link.id);
          if (inv) linkRestInverseMap[link.name] = Array.from(inv.elements);
        }
      }

      const extraFiles: Record<string, string> = {};
      if (format !== "urdf") {
        extraFiles["robot.xml"] = serializeMJCF(urdfStore.robot, {
          ...serializeOptions,
          meshDir: "meshes",
          meshLinkNames: new Set(Object.keys(linkSolidMap)),
        });
      }

      const blob = await exportURDFInWorker(
        urdfXml,
        linkSolidMap,
        linkRestInverseMap,
        0.001,
        (stage) => {
          urdfStore.exportProgress = stage;
        },
        extraFiles,
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${urdfStore.robot.name}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const label = format === "urdf" ? "URDF" : format === "mjcf" ? "MJCF" : "URDF + MJCF";
      ElMessage.success(`${label} 导出成功`);
      exportCompleteAdVisible.value = true;
    } catch (err) {
      ElMessage.error(`导出失败: ${(err as Error).message}`);
    } finally {
      urdfStore.robot.joints.forEach((j, i) => {
        j.currentValue = savedValues[i];
      });
      updateFKAndFrames();
      urdfStore.exporting = false;
      urdfStore.exportProgress = "";
    }
  }

  return {
    initModules,
    updateFKAndFrames,
    disposeModules,
    getFK,
    isEdgePickMode,
    getSnapData,
    getBaseAxisLength,
    setFrameVisible,
    setAxisLength,
    handleHoverSnap,
    previewAxisCandidate,
    showAxisGizmo,
    hideAxisGizmo,
    cycleAxisCandidate,
    setXray,
    syncOpacityBaseline,
    isXrayActive,
    flipAxis,
    handleBindingClick,
    startEdgePickMode,
    stopEdgePickMode,
    applyPickedEdgeToExistingJoint,
    handleJointCreated,
    handleExportURDF,
    refreshCollisionVisual,
    setCollisionVisible,
  };
}
