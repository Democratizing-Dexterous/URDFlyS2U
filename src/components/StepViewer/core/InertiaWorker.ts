/**
 * 惯性参数计算 Web Worker
 *
 * 使用发散定理（Divergence Theorem）+ 平行轴定理从三角网格直接计算，
 * 无需 OpenCASCADE，避免 OCCT API 版本兼容问题，结果与解析解完全一致。
 *
 * 单位约定（与项目其余部分一致）：
 *   输入坐标  : mm（STEP 世界坐标）
 *   输入密度  : kg/m³
 *   输出质量  : kg
 *   输出质心  : mm（URDFSerializer 负责 ×0.001 → m）
 *   输出惯性  : kg·m²（SI 标准单位，URDFSerializer 直接使用，不再缩放）
 *
 * 算法推导：
 *   对每个三角形 (a, b, c) 以原点为第四顶点构成有符号四面体，
 *   利用 ∫λᵢ² dV = 1/60, ∫λᵢλⱼ dV = 1/120（标准参考四面体）推导各积分项。
 *   Ref: Mirtich (1996) "Fast and Accurate Computation of Polyhedral Mass Properties".
 */

import * as Comlink from 'comlink'
import type { SerializedSolidData, InertialParams } from '../types'

const workerApi = {
  /** 保留 init() 以保持外部接口兼容，纯数学实现无需 OCCT */
  async init(): Promise<void> { /* no-op */ },

  /**
   * 从三角网格（可含多个 Solid）计算惯性参数。
   * @param solidDataList  Link 绑定的所有 Solid（使用 positions + indices 字段）
   * @param density        材料密度 (kg/m³)
   */
  async computeInertia(
    solidDataList: SerializedSolidData[],
    density: number
  ): Promise<InertialParams> {

    // ── 一次遍历，累计所有积分项（单位均为 mm⁵，sumW 为 mm³×6）──────
    let sumW = 0
    let sumWx = 0, sumWy = 0, sumWz = 0
    let sumWxx = 0, sumWyy = 0, sumWzz = 0
    let sumWxy = 0, sumWxz = 0, sumWyz = 0

    for (const { positions, indices } of solidDataList) {
      const nTri = Math.floor(indices.length / 3)
      for (let t = 0; t < nTri; t++) {
        const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2]
        const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2]
        const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2]
        const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2]

        // w = a·(b×c)；正值 = 三角形法线朝外
        const w = ax * (by * cz - bz * cy)
          + ay * (bz * cx - bx * cz)
          + az * (bx * cy - by * cx)
        sumW += w

        // 一阶矩（质心推导）：COM_x = Σ w*(ax+bx+cx) / (4*ΣW)
        sumWx += w * (ax + bx + cx)
        sumWy += w * (ay + by + cy)
        sumWz += w * (az + bz + cz)

        // 二阶矩（对角）：∫x² dV = w/60*(ax²+bx²+cx²+ax*bx+ax*cx+bx*cx)
        sumWxx += w * (ax * ax + bx * bx + cx * cx + ax * bx + ax * cx + bx * cx)
        sumWyy += w * (ay * ay + by * by + cy * cy + ay * by + ay * cy + by * cy)
        sumWzz += w * (az * az + bz * bz + cz * cz + az * bz + az * cz + bz * cz)

        // 二阶矩（互项）：∫xy dV = w/120*(2ax*ay+2bx*by+2cx*cy+ax*by+ay*bx+...)
        sumWxy += w * (2 * ax * ay + 2 * bx * by + 2 * cx * cy
          + ax * by + ay * bx + ax * cy + ay * cx + bx * cy + by * cx)
        sumWxz += w * (2 * ax * az + 2 * bx * bz + 2 * cx * cz
          + ax * bz + az * bx + ax * cz + az * cx + bx * cz + bz * cx)
        sumWyz += w * (2 * ay * az + 2 * by * bz + 2 * cy * cz
          + ay * bz + az * by + ay * cz + az * cy + by * cz + bz * cy)
      }
    }

    // ── 退化保护 ────────────────────────────────────────────────────
    if (Math.abs(sumW) < 1e-10) {
      return { mass: 0, com: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0] }
    }

    // ── 法线朝向修正（内向网格 ⇒ sumW<0，取符号翻转后积分符号一致）──
    if (sumW < 0) {
      sumW = -sumW
      sumWx = -sumWx; sumWy = -sumWy; sumWz = -sumWz
      sumWxx = -sumWxx; sumWyy = -sumWyy; sumWzz = -sumWzz
      sumWxy = -sumWxy; sumWxz = -sumWxz; sumWyz = -sumWyz
    }

    // ── 体积 & 质量 ─────────────────────────────────────────────────
    // V [mm³] = Σw / 6
    // mass [kg] = V_mm³ × ρ_kg/m³ × 1e-9  （1 m³ = 1e9 mm³）
    const V_mm3 = sumW / 6
    const mass = V_mm3 * density * 1e-9

    // ── 质心 [mm] ───────────────────────────────────────────────────
    // COM_x = (Σ w*(ax+bx+cx) / 24) / (Σw/6)  =  sumWx / (4 * sumW)
    const com_x = sumWx / (4 * sumW)
    const com_y = sumWy / (4 * sumW)
    const com_z = sumWz / (4 * sumW)

    // ── 原点处惯性张量 [kg·m²] ───────────────────────────────────────
    // ∫(y²+z²) dV [mm⁵] = (sumWyy+sumWzz) / 60
    // 单位推导：ρ [kg/m³] × integral [mm⁵] × 1e-15 = kg·m²
    //   因为 1 mm⁵ = 1e-15 m⁵，所以 ρ×mm⁵ = kg/m³ × 1e-15 m⁵ = 1e-15 kg·m²  ✓
    const c = density * 1e-15

    const I_O_xx = c * (sumWyy + sumWzz) / 60
    const I_O_yy = c * (sumWxx + sumWzz) / 60
    const I_O_zz = c * (sumWxx + sumWyy) / 60
    // URDF 约定：非对角项 ixy = −ρ∫xy dV（负号）
    const I_O_xy = -c * sumWxy / 120
    const I_O_xz = -c * sumWxz / 120
    const I_O_yz = -c * sumWyz / 120

    // ── 平行轴定理（Steiner）：原点 → 质心 ────────────────────────────
    // I_O 单位: kg·m²；COM 存储在 mm，需换算为 m 才能与 I_O 量纲一致
    // M [kg] × d² [m²] = kg·m² ✓
    const cx_m = com_x * 1e-3, cy_m = com_y * 1e-3, cz_m = com_z * 1e-3
    const ixx = I_O_xx - mass * (cy_m * cy_m + cz_m * cz_m)
    const iyy = I_O_yy - mass * (cx_m * cx_m + cz_m * cz_m)
    const izz = I_O_zz - mass * (cx_m * cx_m + cy_m * cy_m)
    const ixy = I_O_xy + mass * cx_m * cy_m
    const ixz = I_O_xz + mass * cx_m * cz_m
    const iyz = I_O_yz + mass * cy_m * cz_m

    return {
      mass,
      com: [com_x, com_y, com_z],
      inertia: [ixx, ixy, ixz, iyy, iyz, izz]
    }
  }
}

export type InertiaWorkerApi = typeof workerApi

Comlink.expose(workerApi)
