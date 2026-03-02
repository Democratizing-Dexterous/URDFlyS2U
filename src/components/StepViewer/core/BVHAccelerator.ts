/**
 * BVH 加速模块
 * 使用 three-mesh-bvh 加速射线检测，大幅提升 hover 性能
 *
 * 性能提升原理：
 * - 原始射线检测: O(n) - 遍历所有三角形
 * - BVH 加速: O(log n) - 使用空间层级结构快速剪枝
 *
 * 对于 158K 三角形的模型:
 * - 原始: ~158,000 次三角形检测
 * - BVH: ~17 层级检测 (log₂ 158000 ≈ 17)
 */

import * as THREE from 'three'
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH,
    type MeshBVHOptions
} from 'three-mesh-bvh'

// 标记 BVH 是否已初始化
let bvhInitialized = false

/**
 * 初始化 BVH 扩展
 * 将 BVH 方法注入到 Three.js 原型链
 */
export function initBVH(): void {
    if (bvhInitialized) return

    // 扩展 BufferGeometry 原型（使用类型断言避免类型冲突）
    const BufferGeometryProto = THREE.BufferGeometry.prototype as any
    BufferGeometryProto.computeBoundsTree = computeBoundsTree
    BufferGeometryProto.disposeBoundsTree = disposeBoundsTree

    // 使用加速的射线检测替换默认实现
    THREE.Mesh.prototype.raycast = acceleratedRaycast

    bvhInitialized = true
    console.log('BVH 加速已初始化')
}

/**
 * 为几何体构建 BVH
 * @param geometry 要加速的几何体
 * @param options BVH 构建选项
 */
export function buildBVH(geometry: THREE.BufferGeometry, options?: MeshBVHOptions): void {
    if (!bvhInitialized) {
        initBVH()
    }

    // 默认选项：优化查询性能
    const defaultOptions: MeshBVHOptions = {
        maxLeafSize: 10,        // 每个叶节点最多 10 个三角形（替代已弃用的 maxLeafTris）
        strategy: 0,            // SAH 策略，平衡构建时间和查询性能
        ...options
    }

    try {
        console.time('BVH 构建')
            ; (geometry as any).computeBoundsTree(defaultOptions)
        console.timeEnd('BVH 构建')
    } catch (error) {
        console.warn('BVH 构建失败，将使用默认射线检测:', error)
    }
}

/**
 * 销毁几何体的 BVH
 */
export function disposeBVH(geometry: THREE.BufferGeometry): void {
    if ((geometry as any).boundsTree) {
        ; (geometry as any).disposeBoundsTree()
    }
}

/**
 * 检查几何体是否有 BVH
 */
export function hasBVH(geometry: THREE.BufferGeometry): boolean {
    return !!(geometry as any).boundsTree
}
