import type { URDFOrigin } from "../types";
import { detectRobotFormat, type RobotFileFormat } from "./RobotImport";

export interface PackageFile {
  path: string;
  file: File;
}

export interface DescriptorCandidate {
  path: string;
  name: string;
  format: RobotFileFormat;
  robotName: string;
  size: number;
  text: string;
  linkCount: number;
  meshRefCount: number;
}

export interface MeshRef {
  raw: string;
  kind: "visual" | "collision";
  origin: URDFOrigin;
  scale: [number, number, number];
}

export interface ResolvedMeshRef extends MeshRef {
  file: File | null;
  resolvedPath: string | null;
}

export interface LinkMeshBinding {
  linkName: string;
  refs: ResolvedMeshRef[];
}

const MESH_EXT = /\.(stl|obj|dae|ply)$/i;

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function dirOf(path: string): string {
  const i = normalizePath(path).lastIndexOf("/");
  return i < 0 ? "" : normalizePath(path).slice(0, i + 1);
}

function baseOf(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

function stripUriPrefix(raw: string): string {
  return raw
    .replace(/^package:\/\/[^/]+\//, "")
    .replace(/^model:\/\/[^/]+\//, "")
    .replace(/^file:\/\//, "");
}

export function isDescriptorPath(path: string): boolean {
  return /\.(urdf|xml|mjcf)$/i.test(path);
}

export function isMeshPath(path: string): boolean {
  return MESH_EXT.test(path);
}

function parseVec(
  text: string | null,
  fallback: [number, number, number],
): [number, number, number] {
  if (!text) return fallback;
  const nums = text
    .trim()
    .split(/[\s,]+/)
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v));
  if (nums.length === 0) return fallback;
  if (nums.length === 1) return [nums[0], nums[0], nums[0]];
  return [nums[0] ?? fallback[0], nums[1] ?? fallback[1], nums[2] ?? fallback[2]];
}

function parseOriginEl(el: Element | null): URDFOrigin {
  if (!el) return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  return {
    xyz: parseVec(el.getAttribute("xyz"), [0, 0, 0]),
    rpy: parseVec(el.getAttribute("rpy"), [0, 0, 0]),
  };
}

function quatToRpy(q: [number, number, number, number]): [number, number, number] {
  const [w, x, y, z] = q;
  const norm = Math.hypot(w, x, y, z) || 1;
  const nw = w / norm,
    nx = x / norm,
    ny = y / norm,
    nz = z / norm;
  const sinrCosp = 2 * (nw * nx + ny * nz);
  const cosrCosp = 1 - 2 * (nx * nx + ny * ny);
  const roll = Math.atan2(sinrCosp, cosrCosp);
  const sinp = 2 * (nw * ny - nz * nx);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const sinyCosp = 2 * (nw * nz + nx * ny);
  const cosyCosp = 1 - 2 * (ny * ny + nz * nz);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  return [roll, pitch, yaw];
}

function extractMeshRefs(text: string, format: RobotFileFormat): Map<string, MeshRef[]> {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return new Map();
  return format === "mjcf" ? extractMjcfMeshRefs(doc) : extractUrdfMeshRefs(doc);
}

function extractUrdfMeshRefs(doc: Document): Map<string, MeshRef[]> {
  const result = new Map<string, MeshRef[]>();
  const robotEl = doc.querySelector("robot");
  if (!robotEl) return result;

  robotEl.querySelectorAll(":scope > link").forEach((linkEl, idx) => {
    const linkName = linkEl.getAttribute("name") || `Link_${idx + 1}`;
    const refs: MeshRef[] = [];

    for (const kind of ["visual", "collision"] as const) {
      linkEl.querySelectorAll(`:scope > ${kind}`).forEach((el) => {
        const meshEl = el.querySelector("geometry > mesh");
        const raw = meshEl?.getAttribute("filename");
        if (!meshEl || !raw) return;
        refs.push({
          raw,
          kind,
          origin: parseOriginEl(el.querySelector(":scope > origin")),
          scale: parseVec(meshEl.getAttribute("scale"), [1, 1, 1]),
        });
      });
    }

    if (refs.length > 0) result.set(linkName, refs);
  });

  return result;
}

function extractMjcfMeshRefs(doc: Document): Map<string, MeshRef[]> {
  const result = new Map<string, MeshRef[]>();
  const root = doc.documentElement;
  if (!root) return result;

  const meshDir = normalizePath(root.querySelector("compiler")?.getAttribute("meshdir") || "");
  const assets = new Map<string, { file: string; scale: [number, number, number] }>();
  root.querySelectorAll("asset > mesh").forEach((el) => {
    const file = el.getAttribute("file");
    if (!file) return;
    const name = el.getAttribute("name") || baseOf(file).replace(MESH_EXT, "");
    assets.set(name, {
      file: meshDir ? `${meshDir.replace(/\/?$/, "/")}${file}` : file,
      scale: parseVec(el.getAttribute("scale"), [1, 1, 1]),
    });
  });
  if (assets.size === 0) return result;

  const worldbody = root.querySelector("worldbody");
  if (!worldbody) return result;

  const walk = (bodyEl: Element, index: number): void => {
    const bodyName = bodyEl.getAttribute("name") || `body_${index}`;
    const refs: MeshRef[] = [];

    Array.from(bodyEl.children)
      .filter((el) => el.tagName === "geom")
      .forEach((geomEl) => {
        const meshName = geomEl.getAttribute("mesh");
        if (!meshName) return;
        const asset = assets.get(meshName);
        if (!asset) return;
        const pos = parseVec(geomEl.getAttribute("pos"), [0, 0, 0]);
        const quatRaw = geomEl.getAttribute("quat");
        const rpy = quatRaw
          ? quatToRpy(parseVec4(quatRaw))
          : ([0, 0, 0] as [number, number, number]);
        const geomScale = parseVec(geomEl.getAttribute("scale"), [1, 1, 1]);
        refs.push({
          raw: asset.file,
          kind: geomEl.getAttribute("class") === "collision" ? "collision" : "visual",
          origin: { xyz: pos, rpy },
          scale: [
            asset.scale[0] * geomScale[0],
            asset.scale[1] * geomScale[1],
            asset.scale[2] * geomScale[2],
          ],
        });
      });

    if (refs.length > 0) result.set(bodyName, refs);

    let childIndex = 0;
    for (const child of Array.from(bodyEl.children)) {
      if (child.tagName === "body") walk(child, ++childIndex);
    }
  };

  let topIndex = 0;
  for (const child of Array.from(worldbody.children)) {
    if (child.tagName === "body") walk(child, ++topIndex);
  }

  return result;
}

function parseVec4(text: string): [number, number, number, number] {
  const nums = text
    .trim()
    .split(/[\s,]+/)
    .map((v) => parseFloat(v));
  return [nums[0] ?? 1, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0];
}

function resolveMeshFile(
  raw: string,
  descriptorPath: string,
  meshIndex: Map<string, File>,
): { file: File | null; resolvedPath: string | null } {
  const stripped = normalizePath(stripUriPrefix(raw));
  const dir = dirOf(descriptorPath);
  const candidates = [
    `${dir}${stripped}`,
    stripped,
    `${dir}meshes/${baseOf(stripped)}`,
    `meshes/${baseOf(stripped)}`,
    baseOf(stripped),
  ];

  for (const candidate of candidates) {
    const key = normalizePath(candidate).toLowerCase();
    const hit = meshIndex.get(key);
    if (hit) return { file: hit, resolvedPath: normalizePath(candidate) };
  }

  const suffix = `/${baseOf(stripped).toLowerCase()}`;
  for (const [key, file] of meshIndex) {
    if (key.endsWith(suffix)) return { file, resolvedPath: key };
  }

  return { file: null, resolvedPath: null };
}

export function buildMeshIndex(files: PackageFile[]): Map<string, File> {
  const index = new Map<string, File>();
  for (const entry of files) {
    if (!isMeshPath(entry.path)) continue;
    index.set(normalizePath(entry.path).toLowerCase(), entry.file);
  }
  return index;
}

export async function collectDescriptors(files: PackageFile[]): Promise<DescriptorCandidate[]> {
  const candidates: DescriptorCandidate[] = [];

  for (const entry of files) {
    if (!isDescriptorPath(entry.path)) continue;
    if (entry.file.size > 32 * 1024 * 1024) continue;

    let text = "";
    try {
      text = await entry.file.text();
    } catch {
      continue;
    }

    const format = detectRobotFormat(text);
    if (!format) continue;

    const doc = new DOMParser().parseFromString(text, "application/xml");
    const robotName =
      doc.querySelector("robot")?.getAttribute("name") ||
      doc.documentElement?.getAttribute("model") ||
      baseOf(entry.path).replace(/\.[^.]+$/, "");
    const linkCount =
      format === "urdf"
        ? doc.querySelectorAll("robot > link").length
        : doc.querySelectorAll("worldbody body").length;
    const refs = extractMeshRefs(text, format);
    let meshRefCount = 0;
    for (const list of refs.values()) meshRefCount += list.length;

    candidates.push({
      path: normalizePath(entry.path),
      name: baseOf(entry.path),
      format,
      robotName,
      size: entry.file.size,
      text,
      linkCount,
      meshRefCount,
    });
  }

  return candidates.sort((a, b) => b.meshRefCount - a.meshRefCount || b.linkCount - a.linkCount);
}

export function resolveLinkMeshes(
  descriptor: DescriptorCandidate,
  meshIndex: Map<string, File>,
  kinds: { visual: boolean; collision: boolean },
): { bindings: LinkMeshBinding[]; missing: string[] } {
  const refMap = extractMeshRefs(descriptor.text, descriptor.format);
  const bindings: LinkMeshBinding[] = [];
  const missing: string[] = [];

  for (const [linkName, refs] of refMap) {
    const picked: ResolvedMeshRef[] = [];
    const wanted = refs.filter((r) => (r.kind === "visual" ? kinds.visual : kinds.collision));
    const source = wanted.length > 0 ? wanted : [];

    const seen = new Set<string>();
    for (const ref of source) {
      const key = `${ref.raw}|${ref.origin.xyz.join(",")}|${ref.origin.rpy.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const found = resolveMeshFile(ref.raw, descriptor.path, meshIndex);
      if (!found.file) missing.push(ref.raw);
      picked.push({ ...ref, file: found.file, resolvedPath: found.resolvedPath });
    }

    if (picked.length > 0) bindings.push({ linkName, refs: picked });
  }

  return { bindings, missing };
}
