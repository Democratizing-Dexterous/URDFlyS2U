import type { URDFRobot, ExportFormat, CollisionConfig, CollisionMode } from "../types";

export const MILES_FORMAT_VERSION = 1;
export const MILES_EXTENSION = ".miles";

export interface ProjectStats {
  solidCount: number;
  linkCount: number;
  jointCount: number;
  loopCount: number;
  triangleCount: number;
}

export interface ProjectManifest {
  formatVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceHash: string;
  stats: ProjectStats;
}

export interface UrdfSection {
  robot: URDFRobot;
  inertialFrame?: "world";
  totalMass: number;
  lockedSolidIds?: string[];
  exportFormat: ExportFormat;
  baseLinkOrigin: [number, number, number] | null;
  baseLinkRPY: [number, number, number] | null;
  axisHelperScale: number;
  showFrames: boolean;
}

export interface CollisionSection {
  config: CollisionConfig;
  overrides: Record<string, CollisionMode>;
}

export interface CameraSection {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
  near: number;
  far: number;
}

export interface ViewportSection {
  camera: CameraSection | null;
  modelRotationElements: number[] | null;
  showAxes: boolean;
  showGrid: boolean;
  globalOpacity: number;
  isTransparent: boolean;
  sidePanelVisible: boolean;
  sidePanelWidth: number;
  expandedTreeNodeIds: string[];
  selectedTreeNodeIds: string[];
  solidVisibility: Record<string, boolean>;
}

export interface ProjectSnapshot {
  manifest: ProjectManifest;
  urdf: UrdfSection;
  collision: CollisionSection;
  viewport: ViewportSection;
}

export interface ProjectRecord {
  id: string;
  name: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceHash: string;
  createdAt: number;
  updatedAt: number;
  stats: ProjectStats;
  thumbnail?: Blob;
  autosave: boolean;
}

export interface LoadedProject {
  snapshot: ProjectSnapshot;
  stepBytes: Uint8Array;
  thumbnail?: Blob;
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export function migrateSnapshot(raw: unknown): ProjectSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new ProjectFormatError("项目文件内容无法解析");
  }

  const snapshot = raw as Partial<ProjectSnapshot>;
  const version = snapshot.manifest?.formatVersion;

  if (typeof version !== "number") {
    throw new ProjectFormatError("项目文件缺少版本信息，可能已损坏");
  }

  if (version > MILES_FORMAT_VERSION) {
    throw new ProjectFormatError(
      `项目文件版本 ${version} 高于当前支持的 ${MILES_FORMAT_VERSION}，请升级应用后再打开`,
    );
  }

  if (!snapshot.urdf?.robot) {
    throw new ProjectFormatError("项目文件缺少机器人配置");
  }

  return snapshot as ProjectSnapshot;
}
