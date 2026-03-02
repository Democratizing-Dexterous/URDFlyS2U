/**
 * 运动学计算 Web Worker
 * 使用 gl-matrix 在独立线程中执行矩阵运算，避免阻塞 UI
 *
 * 职责：
 *  - 接收主线程传来的 Float32Array 格式矩阵/向量
 *  - 从 SnapNormal 构建目标世界矩阵
 *  - 计算相对父级的位移 (XYZ) 和旋转 (RPY, XYZ 欧拉角)
 */

import * as Comlink from 'comlink'
import { mat4, vec3 } from 'gl-matrix'

/**
 * 从旋转矩阵提取 XYZ 顺序的欧拉角 (Roll-Pitch-Yaw)
 *
 * 旋转矩阵 R = Rz(yaw) × Ry(pitch) × Rx(roll) 时
 * XYZ 内旋 = ZYX 外旋，对应 URDF 标准
 *
 * 矩阵元素索引 (gl-matrix 列主序):
 *   col0 = [m[0], m[1], m[2]]
 *   col1 = [m[4], m[5], m[6]]
 *   col2 = [m[8], m[9], m[10]]
 *
 * 分解公式:
 *   pitch = asin(-m[2])                 (即 -R[0][2])
 *   若 cos(pitch) != 0:
 *     roll  = atan2(m[6], m[10])        (即 R[1][2], R[2][2])
 *     yaw   = atan2(m[1], m[0])         (即 R[0][1], R[0][0])
 *   否则 (万向锁):
 *     roll  = atan2(-m[9], m[5])
 *     yaw   = 0
 */
function mat4ToEulerXYZ(m: mat4): [number, number, number] {
  // gl-matrix 列主序: m[col*4 + row]
  const m00 = m[0], m01 = m[4], m02 = m[8]
  const m10 = m[1], m11 = m[5], m12 = m[9]
  const m20 = m[2], m21 = m[6], m22 = m[10]

  // pitch = asin(clamp(-m20, -1, 1))
  const sy = -m20
  const pitch = Math.asin(Math.max(-1, Math.min(1, sy)))

  let roll: number
  let yaw: number

  if (Math.abs(sy) < 0.99999) {
    // 非万向锁
    roll = Math.atan2(m21, m22)
    yaw = Math.atan2(m10, m00)
  } else {
    // 万向锁：pitch ≈ ±90°
    roll = Math.atan2(-m12, m11)
    yaw = 0
  }

  return [roll, pitch, yaw]
}

/**
 * 从法向量构建正交坐标系旋转矩阵
 * Z 轴对齐 normal，X/Y 通过叉积正交展开
 */
function buildOrthonormalBasis(normal: vec3): { x: vec3; y: vec3; z: vec3 } {
  const z = vec3.normalize(vec3.create(), normal)

  // 选择与 Z 轴最不平行的参考轴
  const absX = Math.abs(z[0])
  const absY = Math.abs(z[1])
  const absZ = Math.abs(z[2])
  const ref: vec3 = absX < absY && absX < absZ
    ? vec3.fromValues(1, 0, 0)
    : absY < absZ
      ? vec3.fromValues(0, 1, 0)
      : vec3.fromValues(0, 0, 1)

  // X = normalize(cross(ref, Z))
  const x = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), ref, z))
  // Y = cross(Z, X) — 已自动归一化（两个单位向量的叉积）
  const y = vec3.cross(vec3.create(), z, x)

  return { x, y, z }
}

const workerApi = {
  /**
   * 计算关节相对于父级的局部变换
   *
   * @param parentWorldMatrix 父级世界矩阵 Float32Array(16) 列主序
   * @param snapPosition 吸附点世界坐标 Float32Array(3)
   * @param snapNormal 吸附法线世界方向 Float32Array(3)
   * @returns { xyz, rpy } 相对坐标
   */
  computeRelativeTransform(
    parentWorldMatrix: Float32Array,
    snapPosition: Float32Array,
    snapNormal: Float32Array
  ): { xyz: [number, number, number]; rpy: [number, number, number] } {
    // 1. 从 snapNormal 构建正交坐标系
    const normal = vec3.fromValues(snapNormal[0], snapNormal[1], snapNormal[2])
    const { x: axisX, y: axisY, z: axisZ } = buildOrthonormalBasis(normal)

    // 2. 构建 T_world_to_joint (4x4 列主序)
    //    旋转部分: 列 0=X, 列 1=Y, 列 2=Z
    //    平移部分: 列 3=snapPosition
    const worldToJoint = mat4.fromValues(
      axisX[0], axisX[1], axisX[2], 0,  // col 0
      axisY[0], axisY[1], axisY[2], 0,  // col 1
      axisZ[0], axisZ[1], axisZ[2], 0,  // col 2
      snapPosition[0], snapPosition[1], snapPosition[2], 1  // col 3
    )

    // 3. 计算父级逆矩阵
    const parentMat = mat4.clone(parentWorldMatrix as unknown as mat4)
    const parentInverse = mat4.create()
    const invertible = mat4.invert(parentInverse, parentMat)

    if (!invertible) {
      // 矩阵不可逆（退化），返回默认值
      return { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    }

    // 4. T_relative = T_parent_inverse × T_world_to_joint
    const relative = mat4.create()
    mat4.multiply(relative, parentInverse, worldToJoint)

    // 5. 提取位移 (列 3 的前三个分量)
    const xyz: [number, number, number] = [relative[12], relative[13], relative[14]]

    // 6. 提取 RPY (XYZ 欧拉角顺序)
    const rpy = mat4ToEulerXYZ(relative)

    return { xyz, rpy }
  }
}

export type KinematicsWorkerApi = typeof workerApi

Comlink.expose(workerApi)
