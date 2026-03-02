/**
 * URDF 导出 Web Worker
 * 将多个 Solid 融合为 STL，并通过 JSZip 打包成 ZIP 下载
 */

import * as Comlink from 'comlink'
import JSZip from 'jszip'
import type { URDFRobot, URDFLink, SerializedSolidData } from '../types'

let oc: any = null

async function initOC(): Promise<any> {
  if (oc) return oc
  const initOpenCascade = (await import('opencascade.js')).default
  oc = await initOpenCascade()
  return oc
}

function withGC<T>(fn: (register: <O>(obj: O) => O) => T): T {
  const toDelete: any[] = []
  const register = <O>(obj: O): O => {
    toDelete.push(obj)
    return obj
  }
  try {
    return fn(register)
  } finally {
    for (const obj of toDelete) {
      try { if (obj && typeof obj.delete === 'function') obj.delete() } catch { /* ignore */ }
    }
  }
}

/**
 * 从三角化数据生成 binary STL
 */
function generateBinarySTL(solidDataList: SerializedSolidData[]): ArrayBuffer {
  // 统计总三角形数
  let totalTriangles = 0
  for (const sd of solidDataList) {
    totalTriangles += sd.indices.length / 3
  }

  // Binary STL: 80 byte header + 4 byte triangle count + 50 bytes per triangle
  const bufferSize = 80 + 4 + totalTriangles * 50
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  // Header (80 bytes, zeroed)
  let offset = 80

  // Triangle count
  view.setUint32(offset, totalTriangles, true)
  offset += 4

  for (const sd of solidDataList) {
    const positions = sd.positions
    const normals = sd.normals
    const indices = sd.indices
    const numTri = indices.length / 3

    for (let t = 0; t < numTri; t++) {
      const i0 = indices[t * 3]
      const i1 = indices[t * 3 + 1]
      const i2 = indices[t * 3 + 2]

      // 计算面法线（从顶点法线平均或叉积）
      const ax = positions[i1 * 3] - positions[i0 * 3]
      const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1]
      const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2]
      const bx = positions[i2 * 3] - positions[i0 * 3]
      const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1]
      const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2]
      let nx = ay * bz - az * by
      let ny = az * bx - ax * bz
      let nz = ax * by - ay * bx
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len; ny /= len; nz /= len

      // Normal (12 bytes)
      view.setFloat32(offset, nx, true); offset += 4
      view.setFloat32(offset, ny, true); offset += 4
      view.setFloat32(offset, nz, true); offset += 4

      // Vertex 1 (12 bytes)
      view.setFloat32(offset, positions[i0 * 3], true); offset += 4
      view.setFloat32(offset, positions[i0 * 3 + 1], true); offset += 4
      view.setFloat32(offset, positions[i0 * 3 + 2], true); offset += 4

      // Vertex 2 (12 bytes)
      view.setFloat32(offset, positions[i1 * 3], true); offset += 4
      view.setFloat32(offset, positions[i1 * 3 + 1], true); offset += 4
      view.setFloat32(offset, positions[i1 * 3 + 2], true); offset += 4

      // Vertex 3 (12 bytes)
      view.setFloat32(offset, positions[i2 * 3], true); offset += 4
      view.setFloat32(offset, positions[i2 * 3 + 1], true); offset += 4
      view.setFloat32(offset, positions[i2 * 3 + 2], true); offset += 4

      // Attribute byte count (2 bytes)
      view.setUint16(offset, 0, true); offset += 2
    }
  }

  return buffer
}

const workerApi = {
  async init(): Promise<void> {
    await initOC()
  },

  /**
   * 导出 URDF ZIP 包
   * @param urdfXml URDF XML 字符串
   * @param linkSolidMap linkName → solid 数据列表
   * @param onProgress 进度回调
   */
  async exportURDF(
    urdfXml: string,
    linkSolidMap: Record<string, SerializedSolidData[]>,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<ArrayBuffer> {
    const zip = new JSZip()

    // 添加 URDF 文件
    zip.file('robot.urdf', urdfXml)

    // 为每个 Link 生成 STL
    const linkNames = Object.keys(linkSolidMap)
    const total = linkNames.length

    for (let i = 0; i < total; i++) {
      const linkName = linkNames[i]
      const solidDataList = linkSolidMap[linkName]

      if (solidDataList.length === 0) continue

      onProgress?.(`正在生成 ${linkName}.stl...`, Math.round(((i + 1) / total) * 80))

      const stlBuffer = generateBinarySTL(solidDataList)
      zip.file(`meshes/${linkName}.stl`, stlBuffer)
    }

    onProgress?.('正在打包 ZIP...', 90)

    // 生成 ZIP
    const zipBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    onProgress?.('导出完成', 100)
    return zipBuffer
  }
}

export type ExportWorkerApi = typeof workerApi

Comlink.expose(workerApi)
