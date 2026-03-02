/**
 * 辅助可视化工具
 * 显示法向虚线、中心点、轴线等辅助元素
 */

import * as THREE from 'three'
import type { GeometryFeature, AuxiliaryLine, AuxiliaryLineType } from '../types'
import { FeatureType } from '../types'

/**
 * 辅助可视化配置
 */
export interface AuxiliaryVisualizerConfig {
  scene: THREE.Scene
  normalLineLength?: number
  normalLineColor?: number
  centerPointColor?: number
  centerPointSize?: number
}

/**
 * 辅助可视化类
 */
export class AuxiliaryVisualizer {
  private scene: THREE.Scene
  private normalLineLength: number
  private normalLineColor: number
  private centerPointColor: number
  private centerPointSize: number

  // 辅助元素组
  private auxiliaryGroup: THREE.Group

  // 活动的辅助线
  private activeLines: Map<string, THREE.Line> = new Map()
  private activePoints: Map<string, THREE.Points> = new Map()
  private activeCenterMarkers: Map<string, THREE.Mesh> = new Map()

  constructor(config: AuxiliaryVisualizerConfig) {
    this.scene = config.scene
    this.normalLineLength = config.normalLineLength ?? 50
    this.normalLineColor = config.normalLineColor ?? 0xff0000
    this.centerPointColor = config.centerPointColor ?? 0x0000ff
    this.centerPointSize = config.centerPointSize ?? 5

    this.auxiliaryGroup = new THREE.Group()
    this.auxiliaryGroup.name = 'AuxiliaryGroup'
    this.scene.add(this.auxiliaryGroup)
  }

  /**
   * 为特征显示法向虚线
   */
  showNormalLine(feature: GeometryFeature): AuxiliaryLine | null {
    // 只对圆、圆弧、圆柱显示法向线
    if (!this.shouldShowNormalLine(feature)) {
      return null
    }

    if (!feature.center || (!feature.normal && !feature.axis)) {
      return null
    }

    const lineId = `normal_${feature.id}`

    // 如果已存在，先移除
    this.hideNormalLine(feature.id)

    // 计算起点和终点（优先用 normal，其次 axis）
    const center = feature.center.clone()
    const normal = (feature.normal || feature.axis)!.clone().normalize()
    const halfLength = this.normalLineLength / 2

    const startPoint = center.clone().sub(normal.clone().multiplyScalar(halfLength))
    const endPoint = center.clone().add(normal.clone().multiplyScalar(halfLength))

    // 创建虚线材质
    const material = new THREE.LineDashedMaterial({
      color: this.normalLineColor,
      linewidth: 4,
      dashSize: 6,
      gapSize: 2
    })

    // 创建几何体
    const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint])

    // 创建线条
    const line = new THREE.Line(geometry, material)
    line.name = lineId
    line.computeLineDistances() // 必须调用以使虚线生效

    this.auxiliaryGroup.add(line)
    this.activeLines.set(feature.id, line)

    // 同时显示中心点标记
    this.showCenterPoint(feature)

    return {
      id: lineId,
      type: 'normal' as AuxiliaryLineType,
      feature,
      startPoint,
      endPoint,
      visible: true,
      color: this.normalLineColor,
      dashed: true
    }
  }

  /**
   * 隐藏特征的法向线
   */
  hideNormalLine(featureId: string): void {
    const line = this.activeLines.get(featureId)
    if (line) {
      this.auxiliaryGroup.remove(line)
      line.geometry.dispose()
        ; (line.material as THREE.Material).dispose()
      this.activeLines.delete(featureId)
    }

    // 同时隐藏中心点
    this.hideCenterPoint(featureId)
  }

  /**
   * 显示中心点标记
   */
  showCenterPoint(feature: GeometryFeature): void {
    if (!feature.center) return

    const pointId = `center_${feature.id}`

    // 如果已存在，先移除
    this.hideCenterPoint(feature.id)

    // 创建中心点球体
    const geometry = new THREE.SphereGeometry(this.centerPointSize / 10, 16, 16)
    const material = new THREE.MeshBasicMaterial({
      color: this.centerPointColor,
      transparent: true,
      opacity: 0.8
    })

    const sphere = new THREE.Mesh(geometry, material)
    sphere.position.copy(feature.center)
    sphere.name = pointId

    this.auxiliaryGroup.add(sphere)
    this.activeCenterMarkers.set(feature.id, sphere)
  }

  /**
   * 隐藏中心点标记
   */
  hideCenterPoint(featureId: string): void {
    const marker = this.activeCenterMarkers.get(featureId)
    if (marker) {
      this.auxiliaryGroup.remove(marker)
      marker.geometry.dispose()
        ; (marker.material as THREE.Material).dispose()
      this.activeCenterMarkers.delete(featureId)
    }
  }

  /**
   * 显示轴线（用于圆柱等）
   */
  showAxisLine(feature: GeometryFeature): AuxiliaryLine | null {
    if (!feature.center || !feature.axis) {
      return null
    }

    const lineId = `axis_${feature.id}`

    // 计算轴线长度（使用高度或默认长度）
    const length = feature.height || this.normalLineLength
    const halfLength = length / 2 + 10 // 额外延伸一点

    const center = feature.center.clone()
    const axis = feature.axis.clone().normalize()

    const startPoint = center.clone().sub(axis.clone().multiplyScalar(halfLength))
    const endPoint = center.clone().add(axis.clone().multiplyScalar(halfLength))

    // 创建点划线材质
    const material = new THREE.LineDashedMaterial({
      color: 0x00ff00,
      linewidth: 2,
      dashSize: 5,
      gapSize: 3
    })

    const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint])
    const line = new THREE.Line(geometry, material)
    line.name = lineId
    line.computeLineDistances()

    this.auxiliaryGroup.add(line)
    this.activeLines.set(`axis_${feature.id}`, line)

    return {
      id: lineId,
      type: 'axis' as AuxiliaryLineType,
      feature,
      startPoint,
      endPoint,
      visible: true,
      color: 0x00ff00,
      dashed: true
    }
  }

  /**
   * 隐藏轴线
   */
  hideAxisLine(featureId: string): void {
    const line = this.activeLines.get(`axis_${featureId}`)
    if (line) {
      this.auxiliaryGroup.remove(line)
      line.geometry.dispose()
        ; (line.material as THREE.Material).dispose()
      this.activeLines.delete(`axis_${featureId}`)
    }
  }

  /**
   * 更新特征的所有辅助元素
   */
  updateFeatureAuxiliary(feature: GeometryFeature): void {
    // 先清除旧的
    this.clearFeatureAuxiliary(feature.id)

    // 根据特征类型显示不同的辅助元素
    if (this.shouldShowNormalLine(feature)) {
      this.showNormalLine(feature)
    }

    // 圆柱额外显示轴线
    if (feature.type === FeatureType.CYLINDER) {
      this.showAxisLine(feature)
    }
  }

  /**
   * 清除特征的所有辅助元素
   */
  clearFeatureAuxiliary(featureId: string): void {
    this.hideNormalLine(featureId)
    this.hideAxisLine(featureId)
    this.hideCenterPoint(featureId)
  }

  /**
   * 清除所有辅助元素
   */
  clearAll(): void {
    // 清除所有线条
    this.activeLines.forEach((line, id) => {
      this.auxiliaryGroup.remove(line)
      line.geometry.dispose()
        ; (line.material as THREE.Material).dispose()
    })
    this.activeLines.clear()

    // 清除所有点
    this.activePoints.forEach((points, id) => {
      this.auxiliaryGroup.remove(points)
      points.geometry.dispose()
        ; (points.material as THREE.Material).dispose()
    })
    this.activePoints.clear()

    // 清除所有中心点标记
    this.activeCenterMarkers.forEach((marker, id) => {
      this.auxiliaryGroup.remove(marker)
      marker.geometry.dispose()
        ; (marker.material as THREE.Material).dispose()
    })
    this.activeCenterMarkers.clear()
  }

  /**
   * 判断特征是否应该显示法向线
   */
  private shouldShowNormalLine(feature: GeometryFeature): boolean {
    // 面特征：圆、圆弧、圆柱
    if ([FeatureType.CIRCLE, FeatureType.ARC, FeatureType.CYLINDER].includes(feature.type)) {
      return true
    }
    // 边特征：圆弧边（edgeCurveType === 'circle'）
    if (feature.edgeIndex !== undefined && feature.edgeCurveType === 'circle') {
      return true
    }
    return false
  }

  /**
   * 设置法向线长度
   */
  setNormalLineLength(length: number): void {
    this.normalLineLength = length
  }

  /**
   * 设置法向线颜色
   */
  setNormalLineColor(color: number): void {
    this.normalLineColor = color

    // 更新现有线条的颜色
    this.activeLines.forEach((line) => {
      const material = line.material as THREE.LineDashedMaterial
      material.color.setHex(color)
    })
  }

  /**
   * 创建圆形轮廓线（用于高亮圆形特征）
   */
  createCircleOutline(feature: GeometryFeature, color: number = 0xffff00): THREE.Line | null {
    if (!feature.center || !feature.normal || !feature.radius) {
      return null
    }

    const segments = 64
    const points: THREE.Vector3[] = []

    // 创建圆形点
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const x = Math.cos(angle) * feature.radius
      const y = Math.sin(angle) * feature.radius
      points.push(new THREE.Vector3(x, y, 0))
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    // 旋转几何体使其法向与特征法向一致
    const defaultNormal = new THREE.Vector3(0, 0, 1)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      defaultNormal,
      feature.normal
    )
    geometry.applyQuaternion(quaternion)

    // 移动到中心位置
    geometry.translate(feature.center.x, feature.center.y, feature.center.z)

    const material = new THREE.LineBasicMaterial({ color })
    const line = new THREE.Line(geometry, material)

    return line
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.clearAll()
    this.scene.remove(this.auxiliaryGroup)
  }
}

export default AuxiliaryVisualizer
