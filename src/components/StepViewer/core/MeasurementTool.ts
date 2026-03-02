/**
 * 尺寸测量工具
 * 支持距离、角度、半径等测量
 */

import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type {
  GeometryFeature,
  MeasurementResult,
  MeasurementType,
  MeasurementConfig
} from '../types'
import { FeatureType } from '../types'

/**
 * 测量工具配置
 */
export interface MeasurementToolConfig {
  scene: THREE.Scene
  camera: THREE.Camera
  container: HTMLElement
  config?: Partial<MeasurementConfig>
}

/**
 * 测量工具类
 */
export class MeasurementTool {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private container: HTMLElement
  private labelRenderer: CSS2DRenderer

  // 测量组
  private measurementGroup: THREE.Group

  // 配置
  private config: MeasurementConfig = {
    unit: 'mm',
    precision: 2,
    showLabel: true,
    lineColor: 0xff6600,
    labelColor: 0x333333
  }

  // 活动测量
  private activeMeasurements: Map<string, {
    result: MeasurementResult
    objects: THREE.Object3D[]
    label?: CSS2DObject
  }> = new Map()

  private measurementIdCounter = 0

  constructor(config: MeasurementToolConfig) {
    this.scene = config.scene
    this.camera = config.camera
    this.container = config.container

    if (config.config) {
      this.config = { ...this.config, ...config.config }
    }

    // 创建测量组
    this.measurementGroup = new THREE.Group()
    this.measurementGroup.name = 'MeasurementGroup'
    this.scene.add(this.measurementGroup)

    // 创建 CSS2D 渲染器用于标签
    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.top = '0'
    this.labelRenderer.domElement.style.left = '0'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    this.container.appendChild(this.labelRenderer.domElement)
  }

  /**
   * 获取 CSS2DRenderer（供 LineMeasurementTool 共享）
   */
  getLabelRenderer(): CSS2DRenderer {
    return this.labelRenderer
  }

  /**
   * 生成测量ID
   */
  private generateId(): string {
    return `measurement_${++this.measurementIdCounter}_${Date.now()}`
  }

  /**
   * 测量两个特征之间的关系（仅支持边特征测距离）
   */
  measureFeatures(
    feature1: GeometryFeature,
    feature2: GeometryFeature
  ): MeasurementResult | null {
    // 距离测量仅支持边特征
    if (feature1.edgeIndex === undefined || feature2.edgeIndex === undefined) {
      return null
    }

    // 尝试各种测量类型
    let result: MeasurementResult | null = null

    // 1. 尝试计算点到点距离
    result = this.measurePointToPoint(feature1, feature2)
    if (result) return result

    // 2. 尝试计算圆心距离
    result = this.measureCenterToCenter(feature1, feature2)
    if (result) return result

    // 3. 尝试计算角度
    result = this.measureAngle(feature1, feature2)
    if (result) return result

    return null
  }

  /**
   * 获取特征的代表性点位（用于距离测量）
   * 面特征使用 center，边特征优先使用 center（圆弧中心），否则取 startPoint/endPoint 的中点
   */
  private getFeaturePoint(feature: GeometryFeature): THREE.Vector3 | null {
    if (feature.center) return feature.center
    if (feature.startPoint && feature.endPoint) {
      return feature.startPoint.clone().add(feature.endPoint).multiplyScalar(0.5)
    }
    if (feature.startPoint) return feature.startPoint
    if (feature.endPoint) return feature.endPoint
    return null
  }

  /**
   * 测量点到点距离
   */
  private measurePointToPoint(
    feature1: GeometryFeature,
    feature2: GeometryFeature
  ): MeasurementResult | null {
    const point1 = this.getFeaturePoint(feature1)
    const point2 = this.getFeaturePoint(feature2)

    if (!point1 || !point2) return null

    const distance = point1.distanceTo(point2)
    const midPoint = point1.clone().add(point2).multiplyScalar(0.5)

    const result: MeasurementResult = {
      id: this.generateId(),
      type: 'distance' as MeasurementType,
      value: distance,
      unit: this.config.unit,
      feature1,
      feature2,
      points: [point1.clone(), point2.clone()],
      displayPosition: midPoint,
      label: `${distance.toFixed(this.config.precision)} ${this.config.unit}`,
      visible: true
    }

    this.createMeasurementVisual(result)
    return result
  }

  /**
   * 测量面到面距离（平行平面）
   */
  private measureFaceToFace(
    feature1: GeometryFeature,
    feature2: GeometryFeature
  ): MeasurementResult | null {
    // 只对平面进行面到面测量
    if (feature1.type !== FeatureType.PLANE || feature2.type !== FeatureType.PLANE) {
      return null
    }

    if (!feature1.center || !feature1.normal || !feature2.center || !feature2.normal) {
      return null
    }

    // 检查是否平行（法向量平行或反平行）
    const dot = Math.abs(feature1.normal.dot(feature2.normal))
    if (dot < 0.99) {
      return null // 不平行
    }

    // 计算点到平面的距离
    const diff = feature2.center.clone().sub(feature1.center)
    const distance = Math.abs(diff.dot(feature1.normal))

    // 计算显示位置
    const midPoint = feature1.center.clone().add(feature2.center).multiplyScalar(0.5)

    const result: MeasurementResult = {
      id: this.generateId(),
      type: 'distance' as MeasurementType,
      value: distance,
      unit: this.config.unit,
      feature1,
      feature2,
      points: [feature1.center.clone(), feature2.center.clone()],
      displayPosition: midPoint,
      label: `${distance.toFixed(this.config.precision)} ${this.config.unit}`,
      visible: true
    }

    this.createMeasurementVisual(result)
    return result
  }

  /**
   * 测量圆心到圆心距离
   */
  private measureCenterToCenter(
    feature1: GeometryFeature,
    feature2: GeometryFeature
  ): MeasurementResult | null {
    // 对圆、圆弧、圆柱进行圆心距离测量
    const circularTypes = [FeatureType.CIRCLE, FeatureType.ARC, FeatureType.CYLINDER]

    if (!circularTypes.includes(feature1.type) && !circularTypes.includes(feature2.type)) {
      return null
    }

    return this.measurePointToPoint(feature1, feature2)
  }

  /**
   * 测量两个特征之间的角度
   */
  measureAngle(
    feature1: GeometryFeature,
    feature2: GeometryFeature
  ): MeasurementResult | null {
    if (!feature1.normal || !feature2.normal) {
      return null
    }

    // 计算法向量之间的角度
    let dot = feature1.normal.dot(feature2.normal)
    dot = Math.max(-1, Math.min(1, dot)) // 限制在 [-1, 1] 范围内

    const angleRad = Math.acos(dot)
    const angleDeg = THREE.MathUtils.radToDeg(angleRad)

    // 计算显示位置
    const displayPosition = feature1.center?.clone() || feature2.center?.clone() || new THREE.Vector3()

    const result: MeasurementResult = {
      id: this.generateId(),
      type: 'angle' as MeasurementType,
      value: angleDeg,
      unit: '°',
      feature1,
      feature2,
      points: [],
      displayPosition,
      label: `${angleDeg.toFixed(this.config.precision)}°`,
      visible: true
    }

    this.createAngleVisual(result)
    return result
  }

  /**
   * 测量单个特征的半径
   */
  measureRadius(feature: GeometryFeature): MeasurementResult | null {
    if (feature.radius === undefined || !feature.center) {
      return null
    }

    const result: MeasurementResult = {
      id: this.generateId(),
      type: 'radius' as MeasurementType,
      value: feature.radius,
      unit: this.config.unit,
      feature1: feature,
      points: [feature.center.clone()],
      displayPosition: feature.center.clone(),
      label: `R${feature.radius.toFixed(this.config.precision)} ${this.config.unit}`,
      visible: true
    }

    this.createRadiusVisual(result, feature)
    return result
  }

  /**
   * 测量单个特征的直径
   */
  measureDiameter(feature: GeometryFeature): MeasurementResult | null {
    if (feature.radius === undefined || !feature.center) {
      return null
    }

    const diameter = feature.radius * 2

    const result: MeasurementResult = {
      id: this.generateId(),
      type: 'diameter' as MeasurementType,
      value: diameter,
      unit: this.config.unit,
      feature1: feature,
      points: [feature.center.clone()],
      displayPosition: feature.center.clone(),
      label: `⌀${diameter.toFixed(this.config.precision)} ${this.config.unit}`,
      visible: true
    }

    this.createRadiusVisual(result, feature)
    return result
  }

  /**
   * 创建测量可视化元素
   */
  private createMeasurementVisual(result: MeasurementResult): void {
    const objects: THREE.Object3D[] = []

    // 创建测量线
    if (result.points.length >= 2) {
      const material = new THREE.LineBasicMaterial({
        color: this.config.lineColor,
        linewidth: 2
      })
      const geometry = new THREE.BufferGeometry().setFromPoints(result.points)
      const line = new THREE.Line(geometry, material)
      line.name = `line_${result.id}`
      this.measurementGroup.add(line)
      objects.push(line)

      // 创建端点标记
      const pointMaterial = new THREE.MeshBasicMaterial({ color: this.config.lineColor })
      result.points.forEach((point, index) => {
        const pointGeometry = new THREE.SphereGeometry(0.5, 8, 8)
        const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial)
        pointMesh.position.copy(point)
        pointMesh.name = `point_${result.id}_${index}`
        this.measurementGroup.add(pointMesh)
        objects.push(pointMesh)
      })
    }

    // 创建标签
    let label: CSS2DObject | undefined
    if (this.config.showLabel) {
      label = this.createLabel(result.label, result.displayPosition)
      this.measurementGroup.add(label)
      objects.push(label)
    }

    this.activeMeasurements.set(result.id, { result, objects, label })
  }

  /**
   * 创建角度可视化
   */
  private createAngleVisual(result: MeasurementResult): void {
    const objects: THREE.Object3D[] = []

    // 创建标签
    let label: CSS2DObject | undefined
    if (this.config.showLabel) {
      label = this.createLabel(result.label, result.displayPosition)
      this.measurementGroup.add(label)
      objects.push(label)
    }

    this.activeMeasurements.set(result.id, { result, objects, label })
  }

  /**
   * 创建半径/直径可视化
   */
  private createRadiusVisual(result: MeasurementResult, feature: GeometryFeature): void {
    const objects: THREE.Object3D[] = []

    if (feature.center && feature.radius) {
      // 创建半径线
      const direction = new THREE.Vector3(1, 0, 0) // 默认方向
      if (feature.normal) {
        // 找一个与法向垂直的方向
        const up = new THREE.Vector3(0, 1, 0)
        direction.crossVectors(feature.normal, up).normalize()
        if (direction.length() < 0.01) {
          direction.crossVectors(feature.normal, new THREE.Vector3(1, 0, 0)).normalize()
        }
      }

      const endPoint = feature.center.clone().add(direction.multiplyScalar(feature.radius))

      const material = new THREE.LineBasicMaterial({
        color: this.config.lineColor,
        linewidth: 2
      })
      const geometry = new THREE.BufferGeometry().setFromPoints([
        feature.center,
        endPoint
      ])
      const line = new THREE.Line(geometry, material)
      line.name = `radius_line_${result.id}`
      this.measurementGroup.add(line)
      objects.push(line)

      // 更新显示位置
      result.displayPosition = feature.center.clone().add(endPoint).multiplyScalar(0.5)
    }

    // 创建标签
    let label: CSS2DObject | undefined
    if (this.config.showLabel) {
      label = this.createLabel(result.label, result.displayPosition)
      this.measurementGroup.add(label)
      objects.push(label)
    }

    this.activeMeasurements.set(result.id, { result, objects, label })
  }

  /**
   * 创建文本标签
   */
  private createLabel(text: string, position: THREE.Vector3): CSS2DObject {
    const div = document.createElement('div')
    div.className = 'measurement-label'
    div.textContent = text
    div.style.cssText = `
      background: rgba(255, 255, 255, 0.95);
      color: #333;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      border: 1px solid #ddd;
      white-space: nowrap;
    `

    const label = new CSS2DObject(div)
    label.position.copy(position)
    return label
  }

  /**
   * 移除测量
   */
  removeMeasurement(id: string): void {
    const measurement = this.activeMeasurements.get(id)
    if (!measurement) return

    measurement.objects.forEach(obj => {
      this.measurementGroup.remove(obj)
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose()
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose()
        }
      }
    })

    this.activeMeasurements.delete(id)
  }

  /**
   * 清除所有测量
   */
  clearAllMeasurements(): void {
    this.activeMeasurements.forEach((_, id) => {
      this.removeMeasurement(id)
    })
    this.activeMeasurements.clear()
  }

  /**
   * 获取所有活动测量
   */
  getMeasurements(): MeasurementResult[] {
    return Array.from(this.activeMeasurements.values()).map(m => m.result)
  }

  /**
   * 设置测量可见性
   */
  setMeasurementVisibility(id: string, visible: boolean): void {
    const measurement = this.activeMeasurements.get(id)
    if (measurement) {
      measurement.result.visible = visible
      measurement.objects.forEach(obj => {
        obj.visible = visible
      })
    }
  }

  /**
   * 更新标签渲染器
   */
  render(): void {
    this.labelRenderer.render(this.scene, this.camera)
  }

  /**
   * 更新尺寸
   */
  updateSize(width: number, height: number): void {
    this.labelRenderer.setSize(width, height)
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<MeasurementConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 检查两个特征是否可测量
   */
  canMeasure(feature1: GeometryFeature, feature2?: GeometryFeature): {
    canMeasure: boolean
    measureTypes: MeasurementType[]
    reason?: string
  } {
    const measureTypes: MeasurementType[] = []

    // 单特征测量
    if (!feature2) {
      if (feature1.radius !== undefined) {
        measureTypes.push('radius' as MeasurementType)
        measureTypes.push('diameter' as MeasurementType)
      }
      if (measureTypes.length === 0) {
        return {
          canMeasure: false,
          measureTypes: [],
          reason: '该特征不支持单独测量'
        }
      }
      return { canMeasure: true, measureTypes }
    }

    // 双特征测量
    // 有中心点就可以测量距离
    if (feature1.center && feature2.center) {
      measureTypes.push('distance' as MeasurementType)
    }

    // 有法向量可以测量角度
    if (feature1.normal && feature2.normal) {
      measureTypes.push('angle' as MeasurementType)
    }

    if (measureTypes.length === 0) {
      return {
        canMeasure: false,
        measureTypes: [],
        reason: '所选特征不支持测量'
      }
    }

    return { canMeasure: true, measureTypes }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.clearAllMeasurements()
    this.scene.remove(this.measurementGroup)
    this.container.removeChild(this.labelRenderer.domElement)
  }
}

export default MeasurementTool
