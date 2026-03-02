/**
 * 几何特征工具类
 * 提供特征显示名称、信息格式化等工具函数
 *
 * 注意：面类型检测已移至 Worker（BRepAdaptor_Surface），
 * 本类仅保留展示层工具函数。
 */

import type { GeometryFeature } from '../types'
import { FeatureType } from '../types'

/**
 * 几何特征工具
 */
export class FeatureDetector {
  /**
   * 判断特征是否需要显示法向辅助线
   */
  isNormalLineFeature(feature: GeometryFeature): boolean {
    return [
      FeatureType.CIRCLE,
      FeatureType.ARC,
      FeatureType.CYLINDER
    ].includes(feature.type)
  }

  /**
   * 获取特征的显示名称
   */
  getFeatureDisplayName(feature: GeometryFeature): string {
    const typeNames: Record<FeatureType, string> = {
      [FeatureType.UNKNOWN]: '未知',
      [FeatureType.FACE]: '面',
      [FeatureType.EDGE]: '边',
      [FeatureType.VERTEX]: '顶点',
      [FeatureType.CIRCLE]: '圆',
      [FeatureType.ARC]: '圆弧',
      [FeatureType.LINE]: '直线',
      [FeatureType.CYLINDER]: '圆柱',
      [FeatureType.PLANE]: '平面',
      [FeatureType.SPHERE]: '球面',
      [FeatureType.CONE]: '圆锥',
      [FeatureType.TORUS]: '圆环'
    }
    return typeNames[feature.type] || '未知'
  }

  /**
   * 获取特征的详细信息
   */
  getFeatureInfo(feature: GeometryFeature): Record<string, string | number> {
    const info: Record<string, string | number> = {
      类型: this.getFeatureDisplayName(feature),
      ID: feature.id
    }

    if (feature.radius !== undefined) {
      info['半径'] = `${feature.radius.toFixed(3)} mm`
    }

    if (feature.type === FeatureType.CIRCLE && feature.radius !== undefined) {
      info['直径'] = `${(feature.radius * 2).toFixed(3)} mm`
    }

    if (feature.height !== undefined) {
      info['高度'] = `${feature.height.toFixed(3)} mm`
    }

    if (feature.semiAngle !== undefined) {
      info['半角'] = `${(feature.semiAngle * 180 / Math.PI).toFixed(2)}°`
    }

    if (feature.majorRadius !== undefined) {
      info['大半径'] = `${feature.majorRadius.toFixed(3)} mm`
    }

    if (feature.minorRadius !== undefined) {
      info['小半径'] = `${feature.minorRadius.toFixed(3)} mm`
    }

    if (feature.center) {
      info['中心点'] = `(${feature.center.x.toFixed(2)}, ${feature.center.y.toFixed(2)}, ${feature.center.z.toFixed(2)})`
    }

    if (feature.normal) {
      info['法向量'] = `(${feature.normal.x.toFixed(3)}, ${feature.normal.y.toFixed(3)}, ${feature.normal.z.toFixed(3)})`
    }

    // 边特征属性
    if (feature.edgeCurveType) {
      info['曲线类型'] = feature.edgeCurveType
    }

    if (feature.length !== undefined) {
      info['长度'] = `${feature.length.toFixed(3)} mm`
    }

    if (feature.startPoint) {
      info['起点'] = `(${feature.startPoint.x.toFixed(2)}, ${feature.startPoint.y.toFixed(2)}, ${feature.startPoint.z.toFixed(2)})`
    }

    if (feature.endPoint) {
      info['终点'] = `(${feature.endPoint.x.toFixed(2)}, ${feature.endPoint.y.toFixed(2)}, ${feature.endPoint.z.toFixed(2)})`
    }

    return info
  }
}

export default FeatureDetector
