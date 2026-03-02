/**
 * 运动学 Worker Composable
 * 使用单例模式管理 KinematicsWorker 实例和 Comlink 代理
 */

import * as Comlink from 'comlink'
import type { KinematicsWorkerApi } from './KinematicsWorker'
import type { KinematicsResult } from '../types'

let worker: Worker | null = null
let workerProxy: Comlink.Remote<KinematicsWorkerApi> | null = null

/**
 * 获取或创建 Worker 实例（单例）
 */
function getProxy(): Comlink.Remote<KinematicsWorkerApi> {
  if (!workerProxy) {
    worker = new Worker(
      new URL('./KinematicsWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerProxy = Comlink.wrap<KinematicsWorkerApi>(worker)
  }
  return workerProxy
}

/**
 * 计算关节相对于父级的局部变换（异步，在 Worker 中执行）
 *
 * @param parentWorldMatrix Three.js Matrix4.elements (Float32Array / number[])
 * @param snapPosition 吸附点世界坐标 [x, y, z]
 * @param snapNormal 吸附法线世界方向 [x, y, z]
 * @returns { xyz, rpy } 相对坐标
 */
export async function computeRelativeTransform(
  parentWorldMatrix: ArrayLike<number>,
  snapPosition: [number, number, number],
  snapNormal: [number, number, number]
): Promise<KinematicsResult> {
  const proxy = getProxy()

  // Three.js Matrix4.elements 是 Float64Array / number[]，转为 Float32Array
  const matBuf = new Float32Array(16)
  for (let i = 0; i < 16; i++) matBuf[i] = parentWorldMatrix[i]

  const posBuf = new Float32Array(snapPosition)
  const normBuf = new Float32Array(snapNormal)

  try {
    const result = await proxy.computeRelativeTransform(
      Comlink.transfer(matBuf, [matBuf.buffer]),
      Comlink.transfer(posBuf, [posBuf.buffer]),
      Comlink.transfer(normBuf, [normBuf.buffer])
    )
    return result
  } catch {
    // Worker 异常兜底
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] }
  }
}

/**
 * 销毁 Worker 实例
 */
export function disposeKinematicsWorker(): void {
  if (workerProxy) {
    workerProxy[Comlink.releaseProxy]()
    workerProxy = null
  }
  if (worker) {
    worker.terminate()
    worker = null
  }
}
