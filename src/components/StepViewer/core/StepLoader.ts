import * as THREE from "three";
import * as Comlink from "comlink";
import type {
  FileValidationResult,
  UploadProgress,
  SerializedSolidData,
  SerializedTreeNode,
  TreeNode,
  SolidObject,
  GeometryFeature,
} from "../types";
import { FeatureType } from "../types";
import { initBVH, buildBVH } from "./BVHAccelerator";
import type { StepParseWorkerApi } from "./StepParseWorker";
import { createWorkerClient } from "./workerClient";

interface PositionStats {
  empty: boolean;
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  centroid: THREE.Vector3;
}

interface SolidInfo {
  index: number;
  data: SerializedSolidData;
  fingerprint: string;
  centroid: THREE.Vector3;
  stats: PositionStats;
}

const client = createWorkerClient<StepParseWorkerApi>(
  () => new Worker(new URL("./StepParseWorker.ts", import.meta.url), { type: "module" }),
  (proxy) => proxy.init(),
);

export async function preloadOcct(): Promise<void> {
  await client.ready();
}

export function isOcctLoaded(): boolean {
  return client.isReady();
}

export function terminateWorker(): void {
  client.dispose();
}

export class StepLoader {
  private static readonly EDGE_COLOR = 0x333333;
  private static readonly EDGE_LINE_WIDTH = 1;

  constructor() {
    initBVH();
  }

  validateFile(file: File): FileValidationResult {
    if (!file) {
      return { valid: false, error: "请选择文件" };
    }

    if (file.size === 0) {
      return { valid: false, error: "文件为空" };
    }

    const fileName = file.name.toLowerCase();
    const validExtensions = [".step", ".stp", ".stl"];
    const hasValidExtension = validExtensions.some((ext) => fileName.endsWith(ext));

    if (!hasValidExtension) {
      return { valid: false, error: "仅支持 .step / .stp / .stl 格式文件" };
    }

    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      return { valid: false, error: "文件大小超过 500MB 限制" };
    }

    return { valid: true, file };
  }

  async loadFile(
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{
    solids: SolidObject[];
    group: THREE.Group;
    treeNodes: TreeNode[];
    tree: SerializedTreeNode;
  }> {
    onProgress?.({
      status: "uploading",
      progress: 5,
      message: "正在读取文件...",
    });

    const fileBuffer = await this.readFileAsArrayBuffer(file);

    onProgress?.({
      status: "parsing",
      progress: 10,
      message: "正在初始化 OpenCascade 引擎...",
    });

    const { solids: serializedSolids, tree } = await this.parseInWorker(fileBuffer, onProgress);

    onProgress?.({
      status: "parsing",
      progress: 80,
      message: "正在构建 3D 模型...",
    });
    await this.yieldToMain();

    const { solids, group } = this.buildScene(serializedSolids);

    const treeNodes = this.buildTreeNodes(tree);

    onProgress?.({
      status: "success",
      progress: 100,
      message: "加载完成",
    });

    return { solids, group, treeNodes, tree };
  }

  rebuildFromSerialized(serializedSolids: SerializedSolidData[]): {
    solids: SolidObject[];
    group: THREE.Group;
  } {
    return this.buildScene(serializedSolids);
  }

  async parseBuffer(
    fileBuffer: ArrayBuffer,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{ solids: SerializedSolidData[]; tree: SerializedTreeNode }> {
    return this.parseInWorker(fileBuffer, onProgress);
  }

  restoreScene(
    serializedSolids: SerializedSolidData[],
    tree: SerializedTreeNode | null,
  ): { solids: SolidObject[]; group: THREE.Group; treeNodes: TreeNode[] } {
    const { solids, group } = this.buildScene(serializedSolids);
    return { solids, group, treeNodes: tree ? this.buildTreeNodes(tree) : [] };
  }

  private buildScene(serializedSolids: SerializedSolidData[]): {
    solids: SolidObject[];
    group: THREE.Group;
  } {
    const { solids, group } = this.buildThreeJSObjects(serializedSolids);

    solids.sort((a, b) => {
      const aIdx = parseInt(a.id.replace("solid_", ""));
      const bIdx = parseInt(b.id.replace("solid_", ""));
      return aIdx - bIdx;
    });

    return { solids, group };
  }

  private async parseInWorker(
    fileBuffer: ArrayBuffer,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{ solids: SerializedSolidData[]; tree: SerializedTreeNode }> {
    const proxy = client.get();

    const progressCallback = onProgress
      ? Comlink.proxy((stage: string, percent: number) => {
          onProgress({
            status: "parsing",
            progress: Math.min(Math.round(percent * 0.7) + 10, 78),
            message: stage,
          });
        })
      : undefined;

    const result = await proxy.parse(fileBuffer, progressCallback);
    return { solids: result.solids, tree: result.tree };
  }

  private buildThreeJSObjects(serializedSolids: SerializedSolidData[]): {
    solids: SolidObject[];
    group: THREE.Group;
  } {
    const group = new THREE.Group();
    const solids: SolidObject[] = [];
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();

    const INSTANCE_THRESHOLD = 3;

    const solidInfos: SolidInfo[] = serializedSolids.map((sd, i) => {
      const stats = this.computePositionStats(sd.positions);
      return {
        index: i,
        data: sd,
        fingerprint: this.computeGeometryFingerprint(sd, stats),
        centroid: stats.centroid,
        stats,
      };
    });

    const groups = new Map<string, SolidInfo[]>();
    for (const info of solidInfos) {
      const list = groups.get(info.fingerprint) || [];
      list.push(info);
      groups.set(info.fingerprint, list);
    }

    for (const [, members] of groups) {
      if (members.length >= INSTANCE_THRESHOLD) {
        this.createInstancedSolids(members, materialCache, solids, group);
      } else {
        for (const member of members) {
          this.createRegularSolid(member.data, member.index, materialCache, solids, group);
        }
      }
    }

    return { solids, group };
  }

  private computePositionStats(positions: Float32Array): PositionStats {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let sumX = 0,
      sumY = 0,
      sumZ = 0;
    const count = positions.length / 3;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i],
        y = positions[i + 1],
        z = positions[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      sumX += x;
      sumY += y;
      sumZ += z;
    }

    if (count === 0 || !isFinite(minX)) {
      return {
        empty: true,
        min: new THREE.Vector3(),
        max: new THREE.Vector3(),
        center: new THREE.Vector3(),
        centroid: new THREE.Vector3(),
      };
    }

    const min = new THREE.Vector3(minX, minY, minZ);
    const max = new THREE.Vector3(maxX, maxY, maxZ);
    return {
      empty: false,
      min,
      max,
      center: new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5),
      centroid: new THREE.Vector3(sumX / count, sumY / count, sumZ / count),
    };
  }

  private computeGeometryFingerprint(solidData: SerializedSolidData, stats: PositionStats): string {
    const posCount = solidData.positions.length / 3;
    const idxCount = solidData.indices.length;
    const faceCount = solidData.faceGroups.length;

    const w = (stats.max.x - stats.min.x).toFixed(2);
    const h = (stats.max.y - stats.min.y).toFixed(2);
    const d = (stats.max.z - stats.min.z).toFixed(2);

    const faceTypeCounts: Record<string, number> = {};
    for (const geom of solidData.faceGeometries) {
      faceTypeCounts[geom.type] = (faceTypeCounts[geom.type] || 0) + 1;
    }
    const faceTypeStr = Object.entries(faceTypeCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, c]) => `${t}${c}`)
      .join(",");

    const shapeHash = this.computeShapeHash(solidData, stats);

    return `${posCount}_${idxCount}_${faceCount}_${w}_${h}_${d}_${faceTypeStr}_${shapeHash}`;
  }

  private computeShapeHash(solidData: SerializedSolidData, stats: PositionStats): string {
    const positions = solidData.positions;
    const indices = solidData.indices;

    const extent = Math.max(
      stats.max.x - stats.min.x,
      stats.max.y - stats.min.y,
      stats.max.z - stats.min.z,
    );
    const quantum = extent > 0 ? extent / 4096 : 1;
    const cx = stats.centroid.x;
    const cy = stats.centroid.y;
    const cz = stats.centroid.z;

    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;

    const mix = (value: number): void => {
      h1 = Math.imul(h1 ^ value, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + value, 0x85ebca6b) >>> 0;
      h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
    };

    for (let i = 0; i < positions.length; i += 3) {
      mix(Math.round((positions[i] - cx) / quantum));
      mix(Math.round((positions[i + 1] - cy) / quantum));
      mix(Math.round((positions[i + 2] - cz) / quantum));
    }

    for (let i = 0; i < indices.length; i++) {
      mix(indices[i]);
    }

    return `${h1.toString(36)}${h2.toString(36)}`;
  }

  private getOrCreateMaterial(
    solidData: SerializedSolidData,
    cache: Map<string, THREE.MeshStandardMaterial>,
  ): THREE.MeshStandardMaterial {
    let colorHex = "8899aa";
    if (solidData.color && solidData.color.length >= 3) {
      colorHex = new THREE.Color(
        solidData.color[0],
        solidData.color[1],
        solidData.color[2],
      ).getHexString();
    }
    let mat = cache.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: parseInt(colorHex, 16),
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
      });
      cache.set(colorHex, mat);
    }
    return mat;
  }

  private createRegularSolid(
    solidData: SerializedSolidData,
    solidIndex: number,
    materialCache: Map<string, THREE.MeshStandardMaterial>,
    solids: SolidObject[],
    group: THREE.Group,
  ): void {
    const geometry = this.createGeometry(solidData);
    const material = this.getOrCreateMaterial(solidData, materialCache);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.name = solidData.name || `Solid_${solidIndex}`;
    mesh.userData = {
      meshIndex: solidIndex,
      solidIndex,
      faceGroups: solidData.faceGroups,
      faceGeometries: solidData.faceGeometries,
    };

    buildBVH(geometry);

    const edgeLines = this.createEdgeLines(geometry);
    if (edgeLines) {
      mesh.add(edgeLines);
    }

    const topologyEdges = this.createTopologyEdges(solidData);
    if (topologyEdges) {
      topologyEdges.visible = false;
      mesh.add(topologyEdges);
    }

    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    const center = new THREE.Vector3();
    boundingBox?.getCenter(center);

    const features = this.buildFeatures(mesh, solidData, solidIndex);
    const edgeFeatures = this.buildEdgeFeatures(mesh, solidData, solidIndex);

    let colorHex: number | undefined;
    if (solidData.color && solidData.color.length >= 3) {
      colorHex = new THREE.Color(
        solidData.color[0],
        solidData.color[1],
        solidData.color[2],
      ).getHex();
    }

    const solid: SolidObject = {
      id: `solid_${solidIndex}`,
      name: mesh.name,
      mesh,
      edgeLines: edgeLines || undefined,
      topologyEdges: topologyEdges || undefined,
      edgeFeatures,
      treeNodeId: `solid_${solidIndex}`,
      boundingBox: boundingBox
        ? {
            min: boundingBox.min.clone(),
            max: boundingBox.max.clone(),
            center: center.clone(),
          }
        : undefined,
      features,
      visible: true,
      opacity: 1,
      selected: false,
      color: colorHex,
      serializedData: solidData,
    };

    solids.push(solid);
    group.add(mesh);
  }

  private createInstancedSolids(
    members: SolidInfo[],
    materialCache: Map<string, THREE.MeshStandardMaterial>,
    solids: SolidObject[],
    group: THREE.Group,
  ): void {
    const ref = members[0];
    const sharedGeometry = this.createGeometry(ref.data);

    const refCentroid = ref.centroid;
    const positions = sharedGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(
        i,
        positions.getX(i) - refCentroid.x,
        positions.getY(i) - refCentroid.y,
        positions.getZ(i) - refCentroid.z,
      );
    }
    positions.needsUpdate = true;
    sharedGeometry.computeVertexNormals();
    sharedGeometry.computeBoundingBox();

    buildBVH(sharedGeometry);

    const instanceMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });

    const instancedMesh = new THREE.InstancedMesh(sharedGeometry, instanceMaterial, members.length);
    instancedMesh.name = `Instanced_${ref.data.name || "Solid"}_x${members.length}`;

    const baseMatrices: THREE.Matrix4[] = [];
    members.forEach((member, i) => {
      const tempMatrix = new THREE.Matrix4().makeTranslation(
        member.centroid.x,
        member.centroid.y,
        member.centroid.z,
      );
      baseMatrices[i] = tempMatrix;
      instancedMesh.setMatrixAt(i, tempMatrix);

      let color = new THREE.Color(0x8899aa);
      if (member.data.color && member.data.color.length >= 3) {
        color = new THREE.Color(member.data.color[0], member.data.color[1], member.data.color[2]);
      }
      instancedMesh.setColorAt(i, color);
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    group.add(instancedMesh);

    let mergedEdgeLines: THREE.LineSegments | null = null;
    const edgeVertexRanges = new Map<number, [number, number]>();

    try {
      const sharedEdgesGeo = new THREE.EdgesGeometry(sharedGeometry, 30);
      const edgePosAttr = sharedEdgesGeo.getAttribute("position");

      if (edgePosAttr && edgePosAttr.count > 0) {
        const vertexCountPerInstance = edgePosAttr.count;
        const totalVertices = vertexCountPerInstance * members.length;
        const allPositions = new Float32Array(totalVertices * 3);
        const allColors = new Float32Array(totalVertices * 3);

        const defaultR = 0.2,
          defaultG = 0.2,
          defaultB = 0.2;

        for (let i = 0; i < members.length; i++) {
          const member = members[i];
          const posOffset = i * vertexCountPerInstance * 3;
          const startVertex = i * vertexCountPerInstance;

          for (let v = 0; v < vertexCountPerInstance; v++) {
            allPositions[posOffset + v * 3] = edgePosAttr.getX(v) + member.centroid.x;
            allPositions[posOffset + v * 3 + 1] = edgePosAttr.getY(v) + member.centroid.y;
            allPositions[posOffset + v * 3 + 2] = edgePosAttr.getZ(v) + member.centroid.z;
            allColors[posOffset + v * 3] = defaultR;
            allColors[posOffset + v * 3 + 1] = defaultG;
            allColors[posOffset + v * 3 + 2] = defaultB;
          }

          edgeVertexRanges.set(i, [startVertex, vertexCountPerInstance]);
        }

        const mergedGeo = new THREE.BufferGeometry();
        mergedGeo.setAttribute("position", new THREE.Float32BufferAttribute(allPositions, 3));
        mergedGeo.setAttribute("color", new THREE.Float32BufferAttribute(allColors, 3));

        const mergedMaterial = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.6,
          depthTest: true,
        });

        mergedEdgeLines = new THREE.LineSegments(mergedGeo, mergedMaterial);
        mergedEdgeLines.name = "mergedEdgeLines";
        mergedEdgeLines.renderOrder = 1;
        group.add(mergedEdgeLines);
      }

      sharedEdgesGeo.dispose();
    } catch {}

    let mergedTopologyEdges: THREE.LineSegments | null = null;
    const topologyEdgeVertexRangesAll = new Map<number, Map<number, [number, number]>>();

    try {
      const refEdgeData = ref.data;
      if (
        refEdgeData.edgeGroups &&
        refEdgeData.edgeGroups.length > 0 &&
        refEdgeData.edgePolylines.length > 0
      ) {
        const refPolylines = refEdgeData.edgePolylines;
        const segmentsPerEdge: Float32Array[] = [];
        let totalSegmentVerts = 0;
        for (const eg of refEdgeData.edgeGroups) {
          const pairs = eg.polylineCount > 1 ? eg.polylineCount - 1 : 0;
          const segs = new Float32Array(pairs * 6);
          for (let p = 0; p < pairs; p++) {
            const idx0 = (eg.polylineStart + p) * 3;
            const idx1 = (eg.polylineStart + p + 1) * 3;
            const o = p * 6;
            segs[o] = refPolylines[idx0] - refCentroid.x;
            segs[o + 1] = refPolylines[idx0 + 1] - refCentroid.y;
            segs[o + 2] = refPolylines[idx0 + 2] - refCentroid.z;
            segs[o + 3] = refPolylines[idx1] - refCentroid.x;
            segs[o + 4] = refPolylines[idx1 + 1] - refCentroid.y;
            segs[o + 5] = refPolylines[idx1 + 2] - refCentroid.z;
          }
          segmentsPerEdge.push(segs);
          totalSegmentVerts += pairs * 2;
        }

        const totalVerts = totalSegmentVerts * members.length;
        const allPos = new Float32Array(totalVerts * 3);
        const allCol = new Float32Array(totalVerts * 3);
        const allEdgeIdx = new Float32Array(totalVerts);
        const defaultR = 0.4,
          defaultG = 0.4,
          defaultB = 0.4;
        let globalOffset = 0;

        for (let mi = 0; mi < members.length; mi++) {
          const member = members[mi];
          const rangesMap = new Map<number, [number, number]>();
          let edgeVOffset = globalOffset;

          for (let ei = 0; ei < segmentsPerEdge.length; ei++) {
            const segs = segmentsPerEdge[ei];
            const segVertCount = segs.length / 3;
            const startV = edgeVOffset;

            for (let v = 0; v < segVertCount; v++) {
              const gi = edgeVOffset * 3;
              allPos[gi] = segs[v * 3] + member.centroid.x;
              allPos[gi + 1] = segs[v * 3 + 1] + member.centroid.y;
              allPos[gi + 2] = segs[v * 3 + 2] + member.centroid.z;
              allCol[gi] = defaultR;
              allCol[gi + 1] = defaultG;
              allCol[gi + 2] = defaultB;
              allEdgeIdx[edgeVOffset] = ei;
              edgeVOffset++;
            }

            rangesMap.set(ei, [startV, segVertCount]);
          }

          topologyEdgeVertexRangesAll.set(mi, rangesMap);
          globalOffset = edgeVOffset;
        }

        const topoGeo = new THREE.BufferGeometry();
        topoGeo.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
        topoGeo.setAttribute("color", new THREE.Float32BufferAttribute(allCol, 3));
        topoGeo.setAttribute("edgeIndex", new THREE.Float32BufferAttribute(allEdgeIdx, 1));

        mergedTopologyEdges = new THREE.LineSegments(
          topoGeo,
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            depthTest: true,
          }),
        );
        mergedTopologyEdges.name = "mergedTopologyEdges";
        mergedTopologyEdges.renderOrder = 2;
        mergedTopologyEdges.visible = false;
        group.add(mergedTopologyEdges);
      }
    } catch {}

    members.forEach((member, i) => {
      const solidIndex = member.index;

      const features = this.buildFeatures(
        instancedMesh as unknown as THREE.Mesh,
        member.data,
        solidIndex,
      );

      const bbox = member.stats.empty
        ? undefined
        : { min: member.stats.min, max: member.stats.max, center: member.stats.center };

      let colorHex: number | undefined;
      if (member.data.color && member.data.color.length >= 3) {
        colorHex = new THREE.Color(
          member.data.color[0],
          member.data.color[1],
          member.data.color[2],
        ).getHex();
      }

      const range = edgeVertexRanges.get(i);
      const topoRanges = topologyEdgeVertexRangesAll.get(i);

      const edgeFeatures = this.buildEdgeFeatures(
        instancedMesh as unknown as THREE.Mesh,
        member.data,
        solidIndex,
      );

      const solid: SolidObject = {
        id: `solid_${solidIndex}`,
        name: member.data.name || `Solid_${solidIndex}`,
        mesh: instancedMesh as unknown as THREE.Mesh,
        instanceId: i,
        instanceBaseMatrix: baseMatrices[i].clone(),
        edgeLines: mergedEdgeLines || undefined,
        edgeVertexRange: range,
        topologyEdges: mergedTopologyEdges || undefined,
        topologyEdgeVertexRanges: topoRanges,
        edgeFeatures,
        treeNodeId: `solid_${solidIndex}`,
        boundingBox: bbox,
        features,
        visible: true,
        opacity: 1,
        selected: false,
        color: colorHex,
        serializedData: member.data,
      };

      solids.push(solid);
    });
  }

  private createGeometry(solidData: SerializedSolidData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(solidData.positions, 3));

    if (solidData.normals && solidData.normals.length > 0) {
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(solidData.normals, 3));
      let allZero = true;
      for (let i = 0; i < Math.min(solidData.normals.length, 30); i++) {
        if (solidData.normals[i] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        geometry.computeVertexNormals();
      }
    } else {
      geometry.computeVertexNormals();
    }

    if (solidData.indices && solidData.indices.length > 0) {
      geometry.setIndex(new THREE.BufferAttribute(solidData.indices, 1));
    }

    if (solidData.faceGroups && solidData.faceGroups.length > 0) {
      const vertexCount = solidData.positions.length / 3;
      const faceIndices = new Float32Array(vertexCount);
      faceIndices.fill(-1);

      const indexArray = solidData.indices;
      for (const group of solidData.faceGroups) {
        for (let i = group.start; i < group.start + group.count; i++) {
          const vertIdx = indexArray[i];
          if (vertIdx !== undefined && vertIdx < vertexCount) {
            faceIndices[vertIdx] = group.faceIndex;
          }
        }
      }

      geometry.setAttribute("faceIndex", new THREE.Float32BufferAttribute(faceIndices, 1));
    }

    return geometry;
  }
  private createEdgeLines(geometry: THREE.BufferGeometry): THREE.LineSegments | null {
    try {
      const edgesGeo = new THREE.EdgesGeometry(geometry, 30);
      if (edgesGeo.getAttribute("position")?.count === 0) return null;

      const edgeMaterial = new THREE.LineBasicMaterial({
        color: StepLoader.EDGE_COLOR,
        linewidth: StepLoader.EDGE_LINE_WIDTH,
        transparent: true,
        opacity: 0.6,
        depthTest: true,
      });

      const lines = new THREE.LineSegments(edgesGeo, edgeMaterial);
      lines.name = "edgeLines";
      lines.renderOrder = 1;
      return lines;
    } catch {
      return null;
    }
  }

  private createTopologyEdges(solidData: SerializedSolidData): THREE.LineSegments | null {
    if (!solidData.edgeGroups || solidData.edgeGroups.length === 0) return null;
    if (!solidData.edgePolylines || solidData.edgePolylines.length === 0) return null;

    try {
      let segmentCount = 0;
      for (const eg of solidData.edgeGroups) {
        if (eg.polylineCount > 1) segmentCount += eg.polylineCount - 1;
      }
      if (segmentCount === 0) return null;

      const vertexCount = segmentCount * 2;
      const segments = new Float32Array(vertexCount * 3);
      const edgeIndices = new Float32Array(vertexCount);
      const polylines = solidData.edgePolylines;

      let v = 0;
      for (const eg of solidData.edgeGroups) {
        for (let p = 0; p < eg.polylineCount - 1; p++) {
          const idx0 = (eg.polylineStart + p) * 3;
          const idx1 = (eg.polylineStart + p + 1) * 3;
          const o = v * 3;
          segments[o] = polylines[idx0];
          segments[o + 1] = polylines[idx0 + 1];
          segments[o + 2] = polylines[idx0 + 2];
          segments[o + 3] = polylines[idx1];
          segments[o + 4] = polylines[idx1 + 1];
          segments[o + 5] = polylines[idx1 + 2];
          edgeIndices[v] = eg.edgeIndex;
          edgeIndices[v + 1] = eg.edgeIndex;
          v += 2;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
      geo.setAttribute("edgeIndex", new THREE.Float32BufferAttribute(edgeIndices, 1));

      const mat = new THREE.LineBasicMaterial({
        color: 0x444444,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
      });

      const lines = new THREE.LineSegments(geo, mat);
      lines.name = "topologyEdges";
      lines.renderOrder = 2;
      return lines;
    } catch {
      return null;
    }
  }

  private buildFeatures(
    mesh: THREE.Mesh,
    solidData: SerializedSolidData,
    solidIndex: number,
  ): GeometryFeature[] {
    const features: GeometryFeature[] = [];

    solidData.faceGeometries.forEach((geom, faceIdx) => {
      const featureType = this.mapFaceType(geom.type);

      const feature: GeometryFeature = {
        id: `feature_${solidIndex}_${faceIdx}`,
        type: featureType,
        mesh,
        faceIndex: faceIdx,
        solidId: `solid_${solidIndex}`,
        treeNodeId: `solid_${solidIndex}_face_${faceIdx}`,
      };

      if (geom.center) {
        feature.center = new THREE.Vector3(geom.center[0], geom.center[1], geom.center[2]);
      }
      if (geom.normal) {
        feature.normal = new THREE.Vector3(
          geom.normal[0],
          geom.normal[1],
          geom.normal[2],
        ).normalize();
      }
      if (geom.axis) {
        feature.axis = new THREE.Vector3(geom.axis[0], geom.axis[1], geom.axis[2]).normalize();
      }
      if (geom.radius !== undefined) feature.radius = geom.radius;
      if (geom.height !== undefined) feature.height = geom.height;
      if (geom.startAngle !== undefined) feature.startAngle = geom.startAngle;
      if (geom.endAngle !== undefined) feature.endAngle = geom.endAngle;
      if (geom.semiAngle !== undefined) feature.semiAngle = geom.semiAngle;
      if (geom.majorRadius !== undefined) feature.majorRadius = geom.majorRadius;
      if (geom.minorRadius !== undefined) feature.minorRadius = geom.minorRadius;

      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        feature.originalColor = (mesh.material as THREE.MeshStandardMaterial).color.getHex();
      }

      features.push(feature);
    });

    return features;
  }

  private mapFaceType(typeStr: string): FeatureType {
    const map: Record<string, FeatureType> = {
      plane: FeatureType.PLANE,
      cylinder: FeatureType.CYLINDER,
      cone: FeatureType.CONE,
      sphere: FeatureType.SPHERE,
      torus: FeatureType.TORUS,
      circle: FeatureType.CIRCLE,
      arc: FeatureType.ARC,
      face: FeatureType.FACE,
    };
    return map[typeStr] || FeatureType.FACE;
  }

  private buildEdgeFeatures(
    mesh: THREE.Mesh,
    solidData: SerializedSolidData,
    solidIndex: number,
  ): GeometryFeature[] {
    const features: GeometryFeature[] = [];
    if (!solidData.edgeGeometries) return features;

    solidData.edgeGeometries.forEach((geom, edgeIdx) => {
      const feature: GeometryFeature = {
        id: `feature_${solidIndex}_edge_${edgeIdx}`,
        type: FeatureType.EDGE,
        mesh,
        edgeIndex: edgeIdx,
        solidId: `solid_${solidIndex}`,
        treeNodeId: `solid_${solidIndex}_edge_${edgeIdx}`,
        edgeCurveType: geom.curveType,
        length: geom.length,
      };

      if (geom.startPoint) {
        feature.startPoint = new THREE.Vector3(
          geom.startPoint[0],
          geom.startPoint[1],
          geom.startPoint[2],
        );
      }
      if (geom.endPoint) {
        feature.endPoint = new THREE.Vector3(geom.endPoint[0], geom.endPoint[1], geom.endPoint[2]);
      }
      if (geom.center) {
        feature.center = new THREE.Vector3(geom.center[0], geom.center[1], geom.center[2]);
      }
      if (geom.axis) {
        feature.axis = new THREE.Vector3(geom.axis[0], geom.axis[1], geom.axis[2]).normalize();
      }
      if (geom.radius !== undefined) feature.radius = geom.radius;
      if (geom.startAngle !== undefined) feature.startAngle = geom.startAngle;
      if (geom.endAngle !== undefined) feature.endAngle = geom.endAngle;

      features.push(feature);
    });

    return features;
  }

  private buildTreeNodes(serialTree: SerializedTreeNode): TreeNode[] {
    const convert = (node: SerializedTreeNode): TreeNode => {
      const treeNode: TreeNode = {
        id: node.id,
        name: node.name,
        type: node.type,
        solidIndex: node.solidIndex,
        faceIndex: node.faceIndex,
        edgeIndex: node.edgeIndex,
        color: node.color,
        visible: true,
      };
      if (node.children && node.children.length > 0) {
        treeNode.children = node.children.map(convert);
      }
      return treeNode;
    };

    const root = convert(serialTree);
    return root.children || [root];
  }

  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsArrayBuffer(file);
    });
  }
}

export default StepLoader;
