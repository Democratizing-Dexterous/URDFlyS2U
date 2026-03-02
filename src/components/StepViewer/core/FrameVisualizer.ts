/**
 * 坐标系可视化
 * 在 Joint origin 位置渲染 RGB 三轴箭头（圆柱体 + 圆锥，随轴长等比缩放线宽）
 */

import * as THREE from 'three'
import type { URDFJoint } from '../types'

export interface FrameVisualizerConfig {
  scene: THREE.Scene
  axisLength?: number
}

// ——— 辅助：创建单轴箭头（圆柱轴杆 + 圆锥箭头，随轴长同比例缩放线宽） ———
function makeAxisArrow(color: number, length: number, axis: 'x' | 'y' | 'z'): THREE.Group {
  const group = new THREE.Group()
  const shaftR = length * 0.025
  const headR = length * 0.065
  const headLen = length * 0.22
  const shaftLen = length - headLen

  const mat = new THREE.MeshBasicMaterial({ color })

  // CylinderGeometry 默认沿 Y 轴，居中在原点
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 8, 1), mat)
  shaft.position.y = shaftLen / 2

  const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headLen, 8), mat)
  head.position.y = shaftLen + headLen / 2

  group.add(shaft, head)

  // 旋转至目标轴：Y 轴保持默认；X 绕 Z 轴旋转 -90°；Z 绕 X 轴旋转 +90°
  if (axis === 'x') group.rotation.z = -Math.PI / 2
  else if (axis === 'z') group.rotation.x = Math.PI / 2

  return group
}

export class FrameVisualizer {
  private scene: THREE.Scene
  private axisLength: number
  private frameGroup: THREE.Group
  /** jointId → Group (3 个 ArrowHelper) */
  private frames = new Map<string, THREE.Group>()

  constructor(config: FrameVisualizerConfig) {
    this.scene = config.scene
    this.axisLength = config.axisLength ?? 0.05
    this.frameGroup = new THREE.Group()
    this.frameGroup.name = 'urdf-frames'
    this.scene.add(this.frameGroup)
  }

  /**
   * 显示/更新一个关节的坐标系
   */
  showFrame(joint: URDFJoint): void {
    this.hideFrame(joint.id)

    const group = new THREE.Group()
    group.name = `frame_${joint.id}`

    // 初始位置（FK 运行后会被 updateFrameTransform 中的世界矩阵覆盖）
    group.position.set(...joint.origin.xyz)
    const [roll, pitch, yaw] = joint.origin.rpy
    group.setRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'))

    const len = this.axisLength
    group.add(makeAxisArrow(0xff2020, len, 'x'))  // X 轴 — 红
    group.add(makeAxisArrow(0x20cc20, len, 'y'))  // Y 轴 — 绿
    group.add(makeAxisArrow(0x2050ff, len, 'z'))  // Z 轴 — 蓝

    this.frames.set(joint.id, group)
    this.frameGroup.add(group)
  }

  /**
   * 更新关节坐标系的变换（FK 计算后调用）
   */
  updateFrameTransform(jointId: string, worldMatrix: THREE.Matrix4): void {
    const group = this.frames.get(jointId)
    if (group) {
      group.matrixAutoUpdate = false
      group.matrix.copy(worldMatrix)
      group.matrixWorldNeedsUpdate = true
    }
  }

  /**
   * 隐藏一个关节的坐标系
   */
  hideFrame(jointId: string): void {
    const group = this.frames.get(jointId)
    if (group) {
      this.frameGroup.remove(group)
      disposeGroup(group)
      this.frames.delete(jointId)
    }
  }

  /**
   * 显示所有关节的坐标系
   */
  showAllFrames(joints: URDFJoint[]): void {
    this.clearAll()
    for (const joint of joints) {
      this.showFrame(joint)
    }
  }

  /**
   * 显示 Base Link 坐标系（原点处稍大的 RGB 箭头，标识机器人绝对零点）
   * origin 为 null 时不显示（未设置基点）
   * @param origin  世界坐标位置
   * @param rpy     基坐标系姿态 [roll, pitch, yaw]（弧度），与 URDF <origin rpy> 约定一致
   *                null/undefined 时等同于 [0,0,0]（与世界坐标系同向）
   */
  showBaseFrame(origin: [number, number, number] | null, rpy?: [number, number, number]): void {
    // 移除旧的 base frame
    const existing = this.frames.get('__base__')
    if (existing) {
      this.frameGroup.remove(existing)
      disposeGroup(existing)
      this.frames.delete('__base__')
    }

    if (!origin) return  // 未设置基点时不渲染

    const group = new THREE.Group()
    group.name = 'frame___base__'
    group.position.set(origin[0], origin[1], origin[2])

    // 使用 RPY 欧拉角设置旋转（ZYX 顺序 = URDF rpy 约定），与 showFrame() 逻辑完全一致
    if (rpy) {
      const [roll, pitch, yaw] = rpy
      group.setRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'))
    }

    const len = this.axisLength * 1.6  // 基坐标系箭头稍大，以示区分
    group.add(makeAxisArrow(0xff2020, len, 'x'))
    group.add(makeAxisArrow(0x20cc20, len, 'y'))
    group.add(makeAxisArrow(0x2050ff, len, 'z'))

    this.frames.set('__base__', group)
    this.frameGroup.add(group)
  }

  /**
   * 设置整体可见性
   */
  setVisible(visible: boolean): void {
    this.frameGroup.visible = visible
  }

  /**
   * 设置轴长度并重建
   */
  setAxisLength(length: number): void {
    this.axisLength = length
  }

  /**
   * 清除所有坐标系
   */
  clearAll(): void {
    for (const [id, group] of this.frames) {
      this.frameGroup.remove(group)
      disposeGroup(group)
    }
    this.frames.clear()
  }

  dispose(): void {
    this.clearAll()
    this.scene.remove(this.frameGroup)
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose())
      } else {
        obj.material?.dispose()
      }
    }
  })
}
