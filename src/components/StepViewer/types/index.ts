import type { Mesh, Vector3, LineSegments, Matrix4 } from "three";

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  file?: File;
}

export type UploadStatus = "idle" | "uploading" | "parsing" | "success" | "error";

export interface UploadProgress {
  status: UploadStatus;
  progress: number;
  message: string;
}

export type TreeNodeType = "root" | "compound" | "solid" | "shell" | "edge";

export type GranularityMode = "solid" | "edge";

export interface TreeNode {
  id: string;
  name: string;
  type: TreeNodeType;
  children?: TreeNode[];
  solidIndex?: number;
  faceIndex?: number;
  edgeIndex?: number;
  color?: number[];
  visible?: boolean;
}

export enum FeatureType {
  UNKNOWN = "unknown",
  FACE = "face",
  EDGE = "edge",
  VERTEX = "vertex",
  CIRCLE = "circle",
  ARC = "arc",
  LINE = "line",
  CYLINDER = "cylinder",
  PLANE = "plane",
  SPHERE = "sphere",
  CONE = "cone",
  TORUS = "torus",
}

export interface GeometryFeature {
  id: string;
  type: FeatureType;
  mesh: Mesh;
  faceIndex?: number;
  edgeIndex?: number;
  solidId?: string;
  treeNodeId?: string;
  center?: Vector3;
  normal?: Vector3;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  axis?: Vector3;
  height?: number;
  semiAngle?: number;
  majorRadius?: number;
  minorRadius?: number;
  length?: number;
  startPoint?: Vector3;
  endPoint?: Vector3;
  edgeCurveType?: string;
  originalColor?: number;
  userData?: Record<string, unknown>;
}

export interface SolidObject {
  id: string;
  name: string;
  mesh: Mesh;
  edgeLines?: LineSegments;
  topologyEdges?: LineSegments;
  edgeFeatures: GeometryFeature[];
  treeNodeId?: string;
  boundingBox?: {
    min: Vector3;
    max: Vector3;
    center: Vector3;
  };
  instanceId?: number;
  instanceBaseMatrix?: Matrix4;
  edgeVertexRange?: [number, number];
  topologyEdgeVertexRanges?: Map<number, [number, number]>;
  features: GeometryFeature[];
  visible: boolean;
  opacity: number;
  selected: boolean;
  color?: number;
  serializedData?: SerializedSolidData;
}

export interface SelectionInfo {
  feature: GeometryFeature;
  solid?: SolidObject;
  point: Vector3;
  distance: number;
}

export enum ViewPreset {
  FRONT = "front",
  BACK = "back",
  TOP = "top",
  BOTTOM = "bottom",
  LEFT = "left",
  RIGHT = "right",
  ISOMETRIC = "isometric",
}

export interface CameraConfig {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  fov: number;
  near: number;
  far: number;
}

export interface RenderConfig {
  antialias: boolean;
  backgroundColor: number;
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  enableShadows: boolean;
}

export interface FaceGroupInfo {
  start: number;
  count: number;
  faceIndex: number;
}

export interface FaceGeometryData {
  type: string;
  center?: number[];
  normal?: number[];
  radius?: number;
  axis?: number[];
  height?: number;
  semiAngle?: number;
  majorRadius?: number;
  minorRadius?: number;
  uBounds?: number[];
  vBounds?: number[];
  startAngle?: number;
  endAngle?: number;
}

export interface EdgeGroupInfo {
  edgeIndex: number;
  polylineStart: number;
  polylineCount: number;
  adjacentFaceIndices: number[];
}

export interface EdgeGeometryData {
  curveType: string;
  length: number;
  startPoint: number[];
  endPoint: number[];
  radius?: number;
  center?: number[];
  axis?: number[];
  startAngle?: number;
  endAngle?: number;
}

export type MeshUnit = "auto" | "mm" | "cm" | "m" | "inch";

export interface MeshImportSettings {
  unit: MeshUnit;
  split: boolean;
  minTriangles: number;
  separateTouching: boolean;
}

export interface ModelUploadOptions {
  keepStructure: boolean;
  mesh: MeshImportSettings;
}

export interface SolidMassProps {
  volume: number;
  com: [number, number, number];
  inertiaAtCom: [number, number, number, number, number, number];
}

export interface SerializedSolidData {
  name: string;
  color?: number[];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceGroups: FaceGroupInfo[];
  faceGeometries: FaceGeometryData[];
  edgeGroups: EdgeGroupInfo[];
  edgeGeometries: EdgeGeometryData[];
  edgePolylines: Float32Array;
  massProps?: SolidMassProps;
}

export interface SerializedTreeNode {
  id: string;
  name: string;
  type: TreeNodeType;
  children?: SerializedTreeNode[];
  solidIndex?: number;
  faceIndex?: number;
  edgeIndex?: number;
  color?: number[];
}

export type WorkerRequest = { type: "init" } | { type: "parse"; fileBuffer: ArrayBuffer };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; stage: string; percent: number }
  | { type: "result"; solids: SerializedSolidData[]; tree: SerializedTreeNode; success: boolean }
  | { type: "error"; message: string };

export type JointType =
  | "revolute"
  | "continuous"
  | "prismatic"
  | "fixed"
  | "ball"
  | "floating"
  | "planar";

export const JOINT_TYPE_OPTIONS: { value: JointType; label: string }[] = [
  { value: "revolute", label: "Revolute（旋转）" },
  { value: "continuous", label: "Continuous（连续旋转）" },
  { value: "prismatic", label: "Prismatic（移动）" },
  { value: "ball", label: "Ball（球关节）" },
  { value: "planar", label: "Planar（平面）" },
  { value: "floating", label: "Floating（自由）" },
  { value: "fixed", label: "Fixed（固定）" },
];

export function isLimitedJoint(type: JointType): boolean {
  return type === "revolute" || type === "prismatic" || type === "ball";
}

export type LoopConstraintType = "connect" | "weld";

export interface LoopClosure {
  id: string;
  name: string;
  type: LoopConstraintType;
  linkAId: string;
  linkBId: string;
  anchor: [number, number, number];
  solref: [number, number];
  enabled: boolean;
}

export type ExportFormat = "urdf" | "mjcf" | "both";

export interface InertialParams {
  mass: number;
  com: [number, number, number];
  inertia: [number, number, number, number, number, number];
}

export interface SolidInertiaResult {
  index: number;
  name: string;
  volume: number;
  refMass: number;
  com: [number, number, number];
  inertiaAtCom: [number, number, number, number, number, number];
}

export interface SolidMassEntry {
  solidId: string;
  name: string;
  volume: number;
  mass: number;
  com: [number, number, number];
  refMass: number;
  inertiaAtCom: [number, number, number, number, number, number];
  locked?: boolean;
}

export interface URDFOrigin {
  xyz: [number, number, number];
  rpy: [number, number, number];
}

export interface URDFLink {
  id: string;
  name: string;
  solidIds: string[];
  inertial: InertialParams | null;
  solidMasses?: Record<string, number>;
}

export interface JointLimits {
  lower: number;
  upper: number;
  effort: number;
  velocity: number;
}

export interface URDFJoint {
  id: string;
  name: string;
  type: JointType;
  parentLinkId: string;
  childLinkId: string;
  origin: URDFOrigin;
  axis: [number, number, number];
  axisOffset: [number, number, number];
  limits: JointLimits;
  currentValue: number;
  ballValue?: [number, number, number];
}

export interface URDFRobot {
  name: string;
  links: URDFLink[];
  joints: URDFJoint[];
  loops: LoopClosure[];
}

export interface RobotPackagePayload {
  robot: URDFRobot;
  solids: SerializedSolidData[];
  tree: SerializedTreeNode;
  linkSolidNames: Map<string, string[]>;
  fileName: string;
  triangles: number;
  warnings: string[];
}

export type CollisionShapeType = "box" | "cylinder" | "sphere";

export type CollisionMode = "auto" | CollisionShapeType;

export const COLLISION_SHAPE_OPTIONS: { value: CollisionMode; label: string }[] = [
  { value: "auto", label: "自动（最贴合）" },
  { value: "box", label: "Box（长方体）" },
  { value: "cylinder", label: "Cylinder（圆柱）" },
  { value: "sphere", label: "Sphere（球）" },
];

export interface CollisionShape {
  linkId: string;
  type: CollisionShapeType;
  center: [number, number, number];
  quat: [number, number, number, number];
  halfExtents: [number, number, number];
  radius: number;
  height: number;
  meshVolume: number;
  shapeVolume: number;
  originalHalfExtents: [number, number, number];
  shrunk: boolean;
}

export interface CollisionConflict {
  linkAId: string;
  linkBId: string;
  depth: number;
}

export interface CollisionConfig {
  mode: CollisionMode;
  margin: number;
  sweepCheck: boolean;
  sweepSamples: number;
  minScale: number;
  visible: boolean;
  useForExport: boolean;
}

export interface CollisionBuildResult {
  shapes: CollisionShape[];
  conflicts: CollisionConflict[];
  iterations: number;
}

export type JointWizardStep = "select-links" | "pick-edge" | "adjust-origin" | "set-type";

export interface BindingModeState {
  active: boolean;
  targetLinkId: string | null;
}

export interface SnapData {
  position: [number, number, number];
  normal: [number, number, number];
  featureType: "circle" | "arc" | "line";
  frame?: {
    x: [number, number, number];
    y: [number, number, number];
    z: [number, number, number];
  };
}

export interface KinematicsResult {
  xyz: [number, number, number];
  rpy: [number, number, number];
}
