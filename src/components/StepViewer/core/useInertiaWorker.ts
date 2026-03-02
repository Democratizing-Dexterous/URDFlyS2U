/**
 * 惯性计算 Worker Composable
 * 使用单例模式管理 InertiaWorker 实例和 Comlink 代理
 */

import * as Comlink from 'comlink'
import type { InertiaWorkerApi } from './InertiaWorker'
import type { SerializedSolidData, InertialParams } from '../types'

let worker: Worker | null = null
let workerProxy: Comlink.Remote<InertiaWorkerApi> | null = null
let initPromise: Promise<void> | null = null

/**
 * 获取或创建 Worker 实例（单例），并确保 OC 已初始化
 */
async function getProxy(): Promise<Comlink.Remote<InertiaWorkerApi>> {
  if (!workerProxy) {
    worker = new Worker(
      new URL('./InertiaWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerProxy = Comlink.wrap<InertiaWorkerApi>(worker)
  }
  if (!initPromise) {
    initPromise = workerProxy.init()
  }
  await initPromise
  return workerProxy
}

/**
 * 计算单个 Link 的惯性参数（质量、质心、惯性张量）
 * @param solidDataList  Link 绑定的所有 Solid 序列化数据
 * @param density        材料密度 (kg/m³)
 * @returns InertialParams
 */
export async function computeLinkInertia(
  solidDataList: SerializedSolidData[],
  density: number
): Promise<InertialParams> {
  const proxy = await getProxy()
  // InertiaWorker 仅使用 positions 和 indices 字段。
  // solidDataList 来自 Vue reactive store，对象被 Proxy 包裹，
  // 浏览器 postMessage 的 structuredClone 不支持 Proxy → 会抛出 DataCloneError。
  // 解决方案：提取所需字段重建纯数据对象（不复制 TypedArray 内容，仅重新包装）。
  const plainList: SerializedSolidData[] = solidDataList.map(d => ({
    name: d.name ?? '',
    positions: d.positions,
    normals: d.normals ?? new Float32Array(0),
    indices: d.indices,
    faceGroups: [],
    faceGeometries: [],
    edgeGroups: [],
    edgeGeometries: [],
    edgePolylines: new Float32Array(0),
  }))
  return proxy.computeInertia(plainList, density)
}

/**
 * 计算各连杆在 density=1 时的原始参考惯性（正比于体积，不做 totalMass 缩放）。
 * 供调用方按需自定义每个连杆的质量并推算惯性张量。
 *
 * 关系：inertia_at_mass = refInertia × (mass / refMass)
 *
 * @param links  需要计算的 Link 列表
 * @returns      Map<linkId, InertialParams>（density=1 原始值）
 */
export async function computeRefInertias(
  links: { linkId: string; solidDataList: SerializedSolidData[] }[]
): Promise<Map<string, InertialParams>> {
  const validLinks = links.filter(l => l.solidDataList.length > 0)
  if (validLinks.length === 0) return new Map()

  const result = new Map<string, InertialParams>()
  for (const l of validLinks) {
    try {
      const r = await computeLinkInertia(l.solidDataList, 1)
      if (r.mass > 0) result.set(l.linkId, r)
    } catch {
      // 单个 Link 失败不影响其他
    }
  }
  return result
}

/**
 * 销毁 Worker 实例（页面卸载或不再需要时调用）
 */
export function disposeInertiaWorker(): void {
  if (workerProxy) {
    workerProxy[Comlink.releaseProxy]()
    workerProxy = null
  }
  if (worker) {
    worker.terminate()
    worker = null
  }
  initPromise = null
}

/**
 * 整机惯量计算：按体积比分配总质量，批量计算所有 Link 的惯性参数
 *
 * 算法：先以 density=1 计算各 Link 的参考质量（正比于体积），
 * 求和得参考总质量，再用 k = totalMass / totalRefMass 缩放每个 Link 的
 * 质量和惯性张量（质心位置与密度无关，无需缩放）。
 *
 * @param links        需要计算的 Link 列表（solidDataList 为空的 Link 会被跳过）
 * @param totalMass    整机总质量 (kg)
 * @returns            Map<linkId, InertialParams>
 */
export async function computeAllLinksInertia(
  links: { linkId: string; solidDataList: SerializedSolidData[] }[],
  totalMass: number
): Promise<Map<string, InertialParams>> {
  // 过滤掉没有几何数据的 Link
  const validLinks = links.filter(l => l.solidDataList.length > 0)
  if (validLinks.length === 0) return new Map()

  // 以 density=1 顺序计算各 Link 的参考惯性（质量 = 体积）
  // 注意：使用顺序计算而非 Promise.all，避免并发向同一 Worker 发送多条消息时
  // 任意单条失败导致整批结果全部丢失的问题。
  const refResults: (InertialParams | null)[] = []
  for (const l of validLinks) {
    try {
      const r = await computeLinkInertia(l.solidDataList, 1)
      refResults.push(r)
    } catch {
      // 单个 Link 计算失败时跳过，不影响其余 Link
      refResults.push(null)
    }
  }

  // 仅对计算成功的 Link 求参考总质量
  const totalRefMass = refResults.reduce<number>((sum, r) => sum + (r?.mass ?? 0), 0)
  if (totalRefMass <= 0) return new Map()

  const k = totalMass / totalRefMass

  // 按缩放因子分配质量和惯性张量，跳过计算失败的 Link
  const result = new Map<string, InertialParams>()
  for (let i = 0; i < validLinks.length; i++) {
    const ref = refResults[i]
    if (!ref || ref.mass <= 0) continue   // 零体积或失败的 Link 不写入结果
    result.set(validLinks[i].linkId, {
      mass: ref.mass * k,
      com: ref.com,                                    // 质心位置与密度无关
      inertia: ref.inertia.map(v => v * k) as InertialParams['inertia'],
    })
  }
  return result
}
