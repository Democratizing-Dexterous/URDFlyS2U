import * as THREE from "three";

const rotationScratch = new THREE.Matrix4();
const eulerScratch = new THREE.Euler();

export function fmtNum(n: number): string {
  return Number.isFinite(n) ? parseFloat(n.toFixed(8)).toString() : "0";
}

export function fmtVec3(v: readonly number[]): string {
  return `${fmtNum(v[0])} ${fmtNum(v[1])} ${fmtNum(v[2])}`;
}

export function fmtVec4(v: readonly number[]): string {
  return `${fmtVec3(v)} ${fmtNum(v[3])}`;
}

export function parseVec3(str: string): [number, number, number] {
  const parts = str.trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function matrixToRPY(m: THREE.Matrix4): [number, number, number] {
  eulerScratch.setFromRotationMatrix(rotationScratch.extractRotation(m), "ZYX");
  return [eulerScratch.x, eulerScratch.y, eulerScratch.z];
}
