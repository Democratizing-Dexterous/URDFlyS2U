/**
 * 关节吸附点可视化 (Snap Gizmo)
 * 在吸附点处实时渲染 RGB 三轴坐标系：
 *  - Z 轴（蓝色）= SnapNormal（关节运动轴方向）
 *  - X 轴（红色）/ Y 轴（绿色）= 基于 Z 轴正交展开
 *
 * 性能优化：复用同一组 THREE.Group + ArrowHelper，不在每帧 new/dispose
 */

import * as THREE from 'three'

export interface JointSnapVisualizerConfig {
  scene: THREE.Scene
  axisLength?: number
}

export class JointSnapVisualizer {
  private scene: THREE.Scene
  private axisLength: number
  private group: THREE.Group
  private xArrow: THREE.ArrowHelper
  private yArrow: THREE.ArrowHelper
  private zArrow: THREE.ArrowHelper
  private visible = false

  /** 当前吸附法线（世界空间）— 用于反转 */
  private currentNormal = new THREE.Vector3(0, 0, 1)
  /** 当前吸附位置（世界空间） */
  private currentPosition = new THREE.Vector3()

  constructor(config: JointSnapVisualizerConfig) {
    this.scene = config.scene
    this.axisLength = config.axisLength ?? 0.05

    const len = this.axisLength

    // 预创建三个箭头（后续仅更新 matrix，不销毁重建）
    this.xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(), len, 0xff0000, len * 0.2, len * 0.1
    )
    this.yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(), len, 0x00ff00, len * 0.2, len * 0.1
    )
    this.zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), len, 0x0000ff, len * 0.2, len * 0.1
    )

    this.group = new THREE.Group()
    this.group.name = 'snap-gizmo'
    this.group.add(this.xArrow, this.yArrow, this.zArrow)
    this.group.visible = false
    this.group.matrixAutoUpdate = false

    this.scene.add(this.group)
  }

  /**
   * 更新吸附位置和方向，立即刷新 Gizmo
   * @param position 吸附点世界坐标
   * @param normal 吸附法线/轴线方向（Z 轴将对齐此方向）
   */
  updateSnap(position: THREE.Vector3, normal: THREE.Vector3): void {
    this.currentPosition.copy(position)
    this.currentNormal.copy(normal).normalize()
    this.applyTransform()
    this.group.visible = true
    this.visible = true
  }

  /**
   * 反转当前 Z 轴方向（法线取反）
   * 仅旋转 Gizmo，不改变吸附位置
   */
  flipNormal(): void {
    this.currentNormal.negate()
    this.applyTransform()
  }

  /**
   * 获取当前吸附法线（用于传给 Worker 计算）
   */
  getCurrentNormal(): THREE.Vector3 {
    return this.currentNormal.clone()
  }

  /**
   * 获取当前吸附位置
   */
  getCurrentPosition(): THREE.Vector3 {
    return this.currentPosition.clone()
  }

  /**
   * 当前是否可见
   */
  isVisible(): boolean {
    return this.visible
  }

  /**
   * 隐藏 Gizmo
   */
  hide(): void {
    this.group.visible = false
    this.visible = false
  }

  /**
   * 根据 currentPosition + currentNormal 构建完整变换矩阵并应用到 Group
   */
  private applyTransform(): void {
    const z = this.currentNormal.clone().normalize()

    // 选择与 Z 轴最不平行的参考向量
    const absX = Math.abs(z.x)
    const absY = Math.abs(z.y)
    const absZ = Math.abs(z.z)
    const ref = absX < absY && absX < absZ
      ? new THREE.Vector3(1, 0, 0)
      : absY < absZ
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1)

    // X = normalize(cross(ref, Z))
    const x = new THREE.Vector3().crossVectors(ref, z).normalize()
    // Y = cross(Z, X)
    const y = new THREE.Vector3().crossVectors(z, x)

    // 构建 4x4 矩阵（列主序）
    const m = this.group.matrix
    m.set(
      x.x, y.x, z.x, this.currentPosition.x,
      x.y, y.y, z.y, this.currentPosition.y,
      x.z, y.z, z.z, this.currentPosition.z,
      0, 0, 0, 1
    )
    this.group.matrixWorldNeedsUpdate = true
  }

  dispose(): void {
    this.hide()
    this.scene.remove(this.group)

    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose())
        } else {
          mat?.dispose()
        }
      }
    })
  }
}
