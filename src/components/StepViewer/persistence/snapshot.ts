import * as THREE from "three";
import { toRaw } from "vue";
import type { CameraConfig, URDFRobot } from "../types";
import type { useStepViewerStore } from "../stores/useStepViewerStore";
import type { useURDFStore } from "../stores/useURDFStore";
import {
  MILES_FORMAT_VERSION,
  type CameraSection,
  type ProjectSnapshot,
  type ProjectStats,
} from "./types";

type ViewerStore = ReturnType<typeof useStepViewerStore>;
type UrdfStore = ReturnType<typeof useURDFStore>;

function toCameraSection(config: CameraConfig | null): CameraSection | null {
  if (!config) return null;
  return {
    position: [config.position.x, config.position.y, config.position.z],
    target: [config.target.x, config.target.y, config.target.z],
    up: [config.up.x, config.up.y, config.up.z],
    fov: config.fov,
    near: config.near,
    far: config.far,
  };
}

export function fromCameraSection(section: CameraSection | null): Partial<CameraConfig> | null {
  if (!section) return null;
  return {
    position: new THREE.Vector3(...section.position),
    target: new THREE.Vector3(...section.target),
    up: new THREE.Vector3(...section.up),
    fov: section.fov,
    near: section.near,
    far: section.far,
  };
}

export function computeStats(viewer: ViewerStore, urdf: UrdfStore): ProjectStats {
  let triangleCount = 0;
  for (const solid of viewer.solids) {
    const data = solid.serializedData;
    if (data) triangleCount += data.indices.length / 3;
  }
  return {
    solidCount: viewer.solids.length,
    linkCount: urdf.robot.links.length,
    jointCount: urdf.robot.joints.length,
    loopCount: urdf.robot.loops?.length ?? 0,
    triangleCount,
  };
}

export interface CaptureOptions {
  name: string;
  createdAt?: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceHash: string;
  camera: CameraConfig | null;
}

export function captureSnapshot(
  viewer: ViewerStore,
  urdf: UrdfStore,
  options: CaptureOptions,
): ProjectSnapshot {
  const now = new Date().toISOString();
  const solidVisibility: Record<string, boolean> = {};
  for (const [id, visible] of viewer.solidVisibilityMap) solidVisibility[id] = visible;

  return {
    manifest: {
      formatVersion: MILES_FORMAT_VERSION,
      name: options.name,
      createdAt: options.createdAt ?? now,
      updatedAt: now,
      sourceFileName: options.sourceFileName,
      sourceFileSize: options.sourceFileSize,
      sourceHash: options.sourceHash,
      stats: computeStats(viewer, urdf),
    },
    urdf: {
      robot: structuredClone(toRaw(urdf.robot)),
      inertialFrame: "world",
      totalMass: urdf.totalMass,
      lockedSolidIds: [...urdf.lockedSolidIds],
      exportFormat: urdf.exportFormat,
      baseLinkOrigin: urdf.baseLinkOrigin,
      baseLinkRPY: urdf.baseLinkRPY,
      axisHelperScale: urdf.axisHelperScale,
      showFrames: urdf.showFrames,
    },
    collision: {
      config: structuredClone(toRaw(urdf.collisionConfig)),
      overrides: structuredClone(toRaw(urdf.collisionOverrides)),
    },
    viewport: {
      camera: toCameraSection(options.camera),
      modelRotationElements: viewer.modelRotationElements
        ? [...viewer.modelRotationElements]
        : null,
      showAxes: viewer.showAxes,
      showGrid: viewer.showGrid,
      globalOpacity: viewer.globalOpacity,
      isTransparent: viewer.isTransparent,
      sidePanelVisible: viewer.sidePanelVisible,
      sidePanelWidth: viewer.sidePanelWidth,
      expandedTreeNodeIds: [...viewer.expandedTreeNodeIds],
      selectedTreeNodeIds: [...viewer.selectedTreeNodeIds],
      solidVisibility,
    },
  };
}

export function applyUrdfSection(urdf: UrdfStore, snapshot: ProjectSnapshot): boolean {
  const robot: URDFRobot = structuredClone(snapshot.urdf.robot);

  const legacyInertials = snapshot.urdf.inertialFrame !== "world";
  let cleared = false;
  if (legacyInertials) {
    for (const link of robot.links) {
      if (link.inertial || link.solidMasses) cleared = true;
      link.inertial = null;
      if (link.solidMasses) delete link.solidMasses;
    }
  }

  urdf.importRobot(robot);
  urdf.totalMass = snapshot.urdf.totalMass;
  urdf.lockedSolidIds = legacyInertials ? [] : [...(snapshot.urdf.lockedSolidIds ?? [])];
  urdf.exportFormat = snapshot.urdf.exportFormat;
  urdf.baseLinkOrigin = snapshot.urdf.baseLinkOrigin;
  urdf.baseLinkRPY = snapshot.urdf.baseLinkRPY;
  urdf.axisHelperScale = snapshot.urdf.axisHelperScale;
  urdf.showFrames = snapshot.urdf.showFrames;
  urdf.collisionConfig = structuredClone(snapshot.collision.config);
  urdf.collisionOverrides = structuredClone(snapshot.collision.overrides);
  return cleared;
}

export function applyViewportSection(viewer: ViewerStore, snapshot: ProjectSnapshot): void {
  const view = snapshot.viewport;
  viewer.showAxes = view.showAxes;
  viewer.showGrid = view.showGrid;
  viewer.globalOpacity = view.globalOpacity;
  viewer.isTransparent = view.isTransparent;
  viewer.sidePanelVisible = view.sidePanelVisible;
  viewer.sidePanelWidth = view.sidePanelWidth;
  viewer.expandedTreeNodeIds = [...view.expandedTreeNodeIds];
  viewer.selectedTreeNodeIds = [...view.selectedTreeNodeIds];

  const visibility = new Map<string, boolean>();
  for (const [id, visible] of Object.entries(view.solidVisibility ?? {})) {
    visibility.set(id, visible);
  }
  viewer.solidVisibilityMap = visibility;

  if (view.modelRotationElements) {
    viewer.setModelRotation(new THREE.Matrix4().fromArray(view.modelRotationElements));
  }
}
