import * as Comlink from "comlink";
import { mat4, vec3 } from "gl-matrix";

function mat4ToEulerXYZ(m: mat4): [number, number, number] {
  const m00 = m[0];
  const m10 = m[1],
    m11 = m[5],
    m12 = m[9];
  const m20 = m[2],
    m21 = m[6],
    m22 = m[10];

  const sy = -m20;
  const pitch = Math.asin(Math.max(-1, Math.min(1, sy)));

  let roll: number;
  let yaw: number;

  if (Math.abs(sy) < 0.99999) {
    roll = Math.atan2(m21, m22);
    yaw = Math.atan2(m10, m00);
  } else {
    roll = Math.atan2(-m12, m11);
    yaw = 0;
  }

  return [roll, pitch, yaw];
}

function buildOrthonormalBasis(normal: vec3): { x: vec3; y: vec3; z: vec3 } {
  const z = vec3.normalize(vec3.create(), normal);

  const absX = Math.abs(z[0]);
  const absY = Math.abs(z[1]);
  const absZ = Math.abs(z[2]);
  const ref: vec3 =
    absX < absY && absX < absZ
      ? vec3.fromValues(1, 0, 0)
      : absY < absZ
        ? vec3.fromValues(0, 1, 0)
        : vec3.fromValues(0, 0, 1);

  const x = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), ref, z));
  const y = vec3.cross(vec3.create(), z, x);

  return { x, y, z };
}

const workerApi = {
  computeRelativeTransform(
    parentWorldMatrix: Float32Array,
    snapPosition: Float32Array,
    snapNormal: Float32Array,
    frameBasis?: Float32Array,
  ): { xyz: [number, number, number]; rpy: [number, number, number] } {
    let axisX: vec3, axisY: vec3, axisZ: vec3;
    if (frameBasis && frameBasis.length >= 9) {
      axisX = vec3.fromValues(frameBasis[0], frameBasis[1], frameBasis[2]);
      axisY = vec3.fromValues(frameBasis[3], frameBasis[4], frameBasis[5]);
      axisZ = vec3.fromValues(frameBasis[6], frameBasis[7], frameBasis[8]);
    } else {
      const normal = vec3.fromValues(snapNormal[0], snapNormal[1], snapNormal[2]);
      const basis = buildOrthonormalBasis(normal);
      axisX = basis.x;
      axisY = basis.y;
      axisZ = basis.z;
    }

    const worldToJoint = mat4.fromValues(
      axisX[0],
      axisX[1],
      axisX[2],
      0,
      axisY[0],
      axisY[1],
      axisY[2],
      0,
      axisZ[0],
      axisZ[1],
      axisZ[2],
      0,
      snapPosition[0],
      snapPosition[1],
      snapPosition[2],
      1,
    );

    const parentMat = mat4.clone(parentWorldMatrix as unknown as mat4);
    const parentInverse = mat4.create();
    const invertible = mat4.invert(parentInverse, parentMat);

    if (!invertible) {
      return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    }

    const relative = mat4.create();
    mat4.multiply(relative, parentInverse, worldToJoint);

    const xyz: [number, number, number] = [relative[12], relative[13], relative[14]];

    const rpy = mat4ToEulerXYZ(relative);

    return { xyz, rpy };
  },
};

export type KinematicsWorkerApi = typeof workerApi;

Comlink.expose(workerApi);
