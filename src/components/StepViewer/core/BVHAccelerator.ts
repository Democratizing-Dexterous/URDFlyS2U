import * as THREE from "three";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  type MeshBVHOptions,
} from "three-mesh-bvh";

type BVHGeometry = THREE.BufferGeometry & {
  computeBoundsTree: (options?: MeshBVHOptions) => void;
  disposeBoundsTree: () => void;
};

const DEFAULT_OPTIONS: MeshBVHOptions = { targetLeafSize: 10, strategy: 0 };

let bvhInitialized = false;

export function initBVH(): void {
  if (bvhInitialized) return;

  const proto = THREE.BufferGeometry.prototype as unknown as BVHGeometry;
  proto.computeBoundsTree = computeBoundsTree;
  proto.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;

  bvhInitialized = true;
}

export function buildBVH(geometry: THREE.BufferGeometry, options?: MeshBVHOptions): void {
  initBVH();
  try {
    (geometry as BVHGeometry).computeBoundsTree(
      options ? { ...DEFAULT_OPTIONS, ...options } : DEFAULT_OPTIONS,
    );
  } catch (error) {
    console.warn("BVH 构建失败，将使用默认射线检测:", error);
  }
}
