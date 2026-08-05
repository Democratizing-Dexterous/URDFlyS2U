import * as THREE from "three";
import { FeatureType } from "../types";
import type { GeometryFeature, SolidObject } from "../types";

export type AxisSide = "parent" | "child";

export interface AxisSnapPoint {
  t: number;
  radius: number;
  label: string;
}

export interface AxisCandidate {
  id: string;
  dir: [number, number, number];
  basePoint: [number, number, number];
  origin: [number, number, number];
  originT: number;
  radii: number[];
  parentCount: number;
  childCount: number;
  featureCount: number;
  fitted: boolean;
  score: number;
  label: string;
  detail: string;
  snapPoints: AxisSnapPoint[];
  tMin: number;
  tMax: number;
}

interface AxisFeat {
  dir: THREE.Vector3;
  pos: THREE.Vector3;
  radius: number;
  side: AxisSide;
  weight: number;
  full: boolean;
}

const ANGLE_TOL = Math.cos((1.0 * Math.PI) / 180);

const AXIS_FACE_TYPES = new Set<FeatureType>([
  FeatureType.CYLINDER,
  FeatureType.CONE,
  FeatureType.ARC,
  FeatureType.TORUS,
]);

function featureAxis(feature: GeometryFeature): THREE.Vector3 | null {
  const raw = feature.axis || feature.normal;
  if (!raw) return null;
  const v = raw.clone();
  if (v.lengthSq() < 1e-12) return null;
  return v.normalize();
}

function collectFromSolid(solid: SolidObject, side: AxisSide, out: AxisFeat[]): void {
  for (const f of solid.features) {
    if (!AXIS_FACE_TYPES.has(f.type)) continue;
    if (!f.center || !f.radius || f.radius <= 1e-6) continue;
    const dir = featureAxis(f);
    if (!dir) continue;
    const full = f.type === FeatureType.CYLINDER;
    out.push({
      dir,
      pos: f.center.clone(),
      radius: f.radius,
      side,
      weight: f.type === FeatureType.CYLINDER ? 1.4 : f.type === FeatureType.CONE ? 0.6 : 0.9,
      full,
    });
  }

  for (const f of solid.edgeFeatures) {
    const curve = f.edgeCurveType;
    if (curve !== "circle" && curve !== "arc") continue;
    if (!f.center || !f.radius || f.radius <= 1e-6) continue;
    const dir = featureAxis(f);
    if (!dir) continue;
    out.push({
      dir,
      pos: f.center.clone(),
      radius: f.radius,
      side,
      weight: curve === "circle" ? 1.0 : 0.5,
      full: curve === "circle",
    });
  }
}

interface Cluster {
  dir: THREE.Vector3;
  anchor: THREE.Vector3;
  feats: AxisFeat[];
}

function distanceToAxis(point: THREE.Vector3, anchor: THREE.Vector3, dir: THREE.Vector3): number {
  const d = point.clone().sub(anchor);
  const along = d.dot(dir);
  return d.sub(dir.clone().multiplyScalar(along)).length();
}

function clusterFeatures(feats: AxisFeat[], posTol: number): Cluster[] {
  const clusters: Cluster[] = [];

  for (const f of feats) {
    let matched: Cluster | null = null;
    for (const c of clusters) {
      if (Math.abs(c.dir.dot(f.dir)) < ANGLE_TOL) continue;
      if (distanceToAxis(f.pos, c.anchor, c.dir) > posTol) continue;
      matched = c;
      break;
    }

    if (matched) {
      const flip = matched.dir.dot(f.dir) < 0;
      matched.feats.push({ ...f, dir: flip ? f.dir.clone().negate() : f.dir });
    } else {
      clusters.push({ dir: f.dir.clone(), anchor: f.pos.clone(), feats: [f] });
    }
  }

  for (const c of clusters) {
    const dir = new THREE.Vector3();
    for (const f of c.feats) dir.addScaledVector(f.dir, f.weight);
    if (dir.lengthSq() > 1e-12) c.dir = dir.normalize();

    const radial = new THREE.Vector3();
    let wSum = 0;
    for (const f of c.feats) {
      const d = f.pos.clone().sub(c.anchor);
      d.addScaledVector(c.dir, -d.dot(c.dir));
      radial.addScaledVector(d, f.weight);
      wSum += f.weight;
    }
    if (wSum > 0) c.anchor.addScaledVector(radial, 1 / wSum);
  }

  return clusters;
}

function radiiMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.3, 0.03 * Math.max(a, b));
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export interface CollectAxisOptions {
  parentSolids: SolidObject[];
  childSolids: SolidObject[];
  positionTolerance?: number;
  maxResults?: number;
}

export function collectAxisCandidates(options: CollectAxisOptions): AxisCandidate[] {
  const { parentSolids, childSolids } = options;
  if (parentSolids.length === 0 && childSolids.length === 0) return [];

  const feats: AxisFeat[] = [];
  for (const s of parentSolids) collectFromSolid(s, "parent", feats);
  for (const s of childSolids) collectFromSolid(s, "child", feats);
  if (feats.length === 0) return [];

  const box = new THREE.Box3();
  for (const f of feats) box.expandByPoint(f.pos);
  const diag = box.getSize(new THREE.Vector3()).length();
  const posTol = options.positionTolerance ?? Math.max(1e-3, diag * 3e-4);

  const clusters = clusterFeatures(feats, posTol);
  const candidates: AxisCandidate[] = [];

  clusters.forEach((c, idx) => {
    const parentFeats = c.feats.filter((f) => f.side === "parent");
    const childFeats = c.feats.filter((f) => f.side === "child");
    if (c.feats.length < 1) return;

    const tOf = (p: THREE.Vector3) => p.clone().sub(c.anchor).dot(c.dir);

    const tAll = c.feats.map((f) => tOf(f.pos));
    const tMin = Math.min(...tAll);
    const tMax = Math.max(...tAll);

    let originT: number;
    if (parentFeats.length > 0 && childFeats.length > 0) {
      const pT = parentFeats.map((f) => tOf(f.pos));
      const cT = childFeats.map((f) => tOf(f.pos));
      const lo = Math.max(Math.min(...pT), Math.min(...cT));
      const hi = Math.min(Math.max(...pT), Math.max(...cT));
      originT = hi >= lo ? (lo + hi) / 2 : (tMin + tMax) / 2;
    } else {
      originT = (tMin + tMax) / 2;
    }

    let fitted = false;
    for (const p of parentFeats) {
      for (const ch of childFeats) {
        if (radiiMatch(p.radius, ch.radius)) {
          fitted = true;
          break;
        }
      }
      if (fitted) break;
    }

    const radiiSet: number[] = [];
    for (const f of c.feats) {
      if (!radiiSet.some((r) => radiiMatch(r, f.radius))) radiiSet.push(f.radius);
    }
    radiiSet.sort((a, b) => b - a);

    const snapMap = new Map<string, AxisSnapPoint>();
    for (const f of c.feats) {
      const t = tOf(f.pos);
      const key = `${Math.round(t * 1000)}`;
      if (!snapMap.has(key)) {
        snapMap.set(key, {
          t,
          radius: f.radius,
          label: `Ø${fmt(f.radius * 2)} @ ${fmt(t - originT)}`,
        });
      }
    }
    const snapPoints = Array.from(snapMap.values()).sort((a, b) => a.t - b.t);

    const bothSides = parentFeats.length > 0 && childFeats.length > 0;
    const weightSum = c.feats.reduce((s, f) => s + f.weight, 0);
    if (!bothSides && weightSum < 1.0) return;
    const fullCount = c.feats.filter((f) => f.full).length;
    const span = tMax - tMin;

    let score = 0;
    if (bothSides) score += 120;
    if (fitted) score += 90;
    score += Math.min(weightSum, 12) * 4;
    score += Math.min(fullCount, 8) * 3;
    if (diag > 0) score += Math.min(span / diag, 0.5) * 40;
    const maxRadius = radiiSet[0] ?? 0;
    if (diag > 0) score += Math.min(maxRadius / (diag * 0.25), 1) * 25;

    const origin = c.anchor.clone().addScaledVector(c.dir, originT);

    const detailParts: string[] = [];
    if (bothSides) detailParts.push(fitted ? "轴孔配合" : "父子共轴");
    else detailParts.push(parentFeats.length > 0 ? "仅父件" : "仅子件");
    detailParts.push(`${c.feats.length} 特征`);
    if (span > posTol * 10) detailParts.push(`跨度 ${fmt(span)}`);

    candidates.push({
      id: `axis_${idx}`,
      dir: [c.dir.x, c.dir.y, c.dir.z],
      basePoint: [c.anchor.x, c.anchor.y, c.anchor.z],
      origin: [origin.x, origin.y, origin.z],
      originT,
      radii: radiiSet,
      parentCount: parentFeats.length,
      childCount: childFeats.length,
      featureCount: c.feats.length,
      fitted,
      score,
      label: radiiSet.length > 0 ? `Ø${fmt(radiiSet[0] * 2)}` : "轴线",
      detail: detailParts.join(" · "),
      snapPoints,
      tMin,
      tMax,
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  const max = options.maxResults ?? 8;
  return candidates.slice(0, max);
}
