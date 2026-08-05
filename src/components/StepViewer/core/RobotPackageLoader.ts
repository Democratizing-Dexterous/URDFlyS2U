import * as THREE from "three";
import type { SerializedSolidData, SerializedTreeNode, URDFRobot } from "../types";
import { importStlSolids } from "./useMeshImportWorker";
import { rotateSerializedSolid } from "./ZUpTransform";
import { ForwardKinematics } from "./ForwardKinematics";
import type { LinkMeshBinding, ResolvedMeshRef } from "./RobotPackage";

export interface PackageLoadProgress {
  loaded: number;
  total: number;
  current: string;
}

export interface PackageLoadResult {
  solids: SerializedSolidData[];
  tree: SerializedTreeNode;
  linkSolidNames: Map<string, string[]>;
  triangles: number;
  skipped: string[];
}

function refMatrix(ref: ResolvedMeshRef, unitScale: number): THREE.Matrix4 {
  const [roll, pitch, yaw] = ref.origin.rpy;
  const rotation = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(roll, pitch, yaw, "ZYX"),
  );
  const translation = new THREE.Matrix4().makeTranslation(
    ref.origin.xyz[0] * unitScale,
    ref.origin.xyz[1] * unitScale,
    ref.origin.xyz[2] * unitScale,
  );
  const scale = new THREE.Matrix4().makeScale(ref.scale[0], ref.scale[1], ref.scale[2]);
  return translation.multiply(rotation).multiply(scale);
}

function isStl(name: string): boolean {
  return /\.stl$/i.test(name);
}

function buildRestTransforms(robot: URDFRobot): Map<string, THREE.Matrix4> {
  const fk = new ForwardKinematics();
  fk.setRobot(robot);
  fk.compute();

  const byName = new Map<string, THREE.Matrix4>();
  for (const link of robot.links) {
    const rest = fk.getLinkRestTransform(link.id);
    if (rest) byName.set(link.name, rest);
  }
  return byName;
}

export async function loadRobotPackageGeometry(
  bindings: LinkMeshBinding[],
  unitScale: number,
  robot: URDFRobot,
  onProgress?: (progress: PackageLoadProgress) => void,
): Promise<PackageLoadResult> {
  const solids: SerializedSolidData[] = [];
  const linkSolidNames = new Map<string, string[]>();
  const skipped: string[] = [];
  let triangles = 0;

  const restByLinkName = buildRestTransforms(robot);

  const total = bindings.reduce((sum, b) => sum + b.refs.filter((r) => !!r.file).length, 0);
  let loaded = 0;

  for (const binding of bindings) {
    const names: string[] = [];
    const usable = binding.refs.filter((ref) => ref.file);

    for (let i = 0; i < usable.length; i++) {
      const ref = usable[i];
      const file = ref.file as File;

      if (!isStl(file.name)) {
        skipped.push(`${binding.linkName}: ${file.name}（暂不支持该网格格式）`);
        continue;
      }

      onProgress?.({ loaded, total, current: `${binding.linkName} / ${file.name}` });

      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        skipped.push(`${binding.linkName}: ${file.name}（读取失败）`);
        continue;
      }

      const baseName =
        usable.length === 1 ? binding.linkName : `${binding.linkName}_${String(i + 1)}`;

      try {
        const result = await importStlSolids(buffer, {
          scale: unitScale,
          autoScale: false,
          split: false,
          baseName,
        });

        const rest = restByLinkName.get(binding.linkName);
        const matrix = refMatrix(ref, unitScale);
        if (rest) matrix.premultiply(rest);

        for (const data of result.solids) {
          if (!isIdentity(matrix)) rotateSerializedSolid(data, matrix);
          data.name = result.solids.length === 1 ? baseName : data.name;
          names.push(data.name);
          solids.push(data);
        }
        triangles += result.triangles;
      } catch (error) {
        skipped.push(
          `${binding.linkName}: ${file.name}（${error instanceof Error ? error.message : "解析失败"}）`,
        );
      }

      loaded++;
    }

    if (names.length > 0) linkSolidNames.set(binding.linkName, names);
  }

  onProgress?.({ loaded: total, total, current: "" });

  if (solids.length === 0) {
    throw new Error("没有成功加载任何网格，请确认包内含 .stl 文件");
  }

  return { solids, tree: buildLinkTree(linkSolidNames), linkSolidNames, triangles, skipped };
}

function isIdentity(m: THREE.Matrix4): boolean {
  const e = m.elements;
  const id = new THREE.Matrix4().elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(e[i] - id[i]) > 1e-12) return false;
  }
  return true;
}

function buildLinkTree(linkSolidNames: Map<string, string[]>): SerializedTreeNode {
  let solidIndex = 0;
  const children: SerializedTreeNode[] = [];

  for (const [linkName, names] of linkSolidNames) {
    if (names.length === 1) {
      children.push({
        id: `solid_${solidIndex}`,
        name: linkName,
        type: "solid",
        solidIndex: solidIndex++,
      });
      continue;
    }

    children.push({
      id: `node_link_${linkName}`,
      name: linkName,
      type: "compound",
      children: names.map((name) => ({
        id: `solid_${solidIndex}`,
        name,
        type: "solid" as const,
        solidIndex: solidIndex++,
      })),
    });
  }

  return { id: "node_root", name: "Robot", type: "root", children };
}
