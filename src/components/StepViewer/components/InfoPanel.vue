<template>
  <div class="info-panel">
    <!-- 选中特征信息 -->
    <div class="panel-section" v-if="store.selectedFeatures.length > 0">
      <h3 class="section-title">
        <el-icon><Select /></el-icon>
        选中的特征 ({{ store.selectedFeatures.length }})
      </h3>
      <div class="feature-list">
        <div v-for="feature in store.selectedFeatures" :key="feature.id" class="feature-item">
          <div class="feature-header">
            <span class="feature-type" :style="{ color: getTypeColor(feature.type) }">
              {{ isEdgeFeature(feature) ? getFeatureTypeName(feature.type) : getSolidName(feature) }}
            </span>
            <el-button type="danger" text @click="emit('removeFeature', feature.id)">
              移除
            </el-button>
          </div>
          <div class="feature-props">
            <!-- 实体模式：显示实体名称和包围盒 -->
            <template v-if="!isEdgeFeature(feature)">
              <div class="prop-item">
                <span class="prop-label">实体:</span>
                <span class="prop-value">{{ getSolidName(feature) }}</span>
              </div>
              <div v-if="getSolidBBox(feature)" class="prop-item">
                <span class="prop-label">尺寸:</span>
                <span class="prop-value">{{ getSolidBBox(feature) }}</span>
              </div>
            </template>
            <!-- 边模式：显示详细属性 -->
            <template v-else>
              <div v-if="feature.radius !== undefined" class="prop-item">
                <span class="prop-label">半径:</span>
                <span class="prop-value">{{ feature.radius.toFixed(3) }} mm</span>
              </div>
              <div v-if="feature.edgeCurveType === 'circle' && feature.radius !== undefined" class="prop-item">
                <span class="prop-label">直径:</span>
                <span class="prop-value">{{ (feature.radius * 2).toFixed(3) }} mm</span>
              </div>
              <div v-if="feature.center" class="prop-item">
                <span class="prop-label">中心:</span>
                <span class="prop-value">
                  ({{ feature.center.x.toFixed(2) }}, {{ feature.center.y.toFixed(2) }}, {{
                    feature.center.z.toFixed(2) }})
                </span>
              </div>
              <div v-if="feature.axis" class="prop-item">
                <span class="prop-label">轴向:</span>
                <span class="prop-value">
                  ({{ feature.axis.x.toFixed(3) }}, {{ feature.axis.y.toFixed(3) }}, {{
                    feature.axis.z.toFixed(3) }})
                </span>
              </div>
              <div v-if="feature.edgeCurveType" class="prop-item">
                <span class="prop-label">曲线:</span>
                <span class="prop-value">{{ feature.edgeCurveType }}</span>
              </div>
              <div v-if="feature.length !== undefined" class="prop-item">
                <span class="prop-label">长度:</span>
                <span class="prop-value">{{ feature.length.toFixed(3) }} mm</span>
              </div>
              <div v-if="feature.startPoint" class="prop-item">
                <span class="prop-label">起点:</span>
                <span class="prop-value">
                  ({{ feature.startPoint.x.toFixed(2) }}, {{ feature.startPoint.y.toFixed(2) }}, {{
                    feature.startPoint.z.toFixed(2) }})
                </span>
              </div>
              <div v-if="feature.endPoint" class="prop-item">
                <span class="prop-label">终点:</span>
                <span class="prop-value">
                  ({{ feature.endPoint.x.toFixed(2) }}, {{ feature.endPoint.y.toFixed(2) }}, {{
                    feature.endPoint.z.toFixed(2) }})
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-if="store.selectedFeatures.length === 0">
      <p>点击模型选择特征</p>
      <p class="hint">查看几何属性信息</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { Select } from '@element-plus/icons-vue'
import { FeatureType } from '../types'
import type { GeometryFeature } from '../types'
import { useStepViewerStore } from '../stores/useStepViewerStore'

const store = useStepViewerStore()

const emit = defineEmits<{
  (e: 'removeFeature', id: string): void
}>()

/** 判断是否是边特征 */
function isEdgeFeature(feature: GeometryFeature): boolean {
  return feature.edgeIndex !== undefined
}

/** 获取实体名称 */
function getSolidName(feature: GeometryFeature): string {
  if (!feature.solidId) return '实体'
  const solid = store.solids.find(s => s.id === feature.solidId)
  return solid?.name || '实体'
}

/** 获取实体包围盒信息 */
function getSolidBBox(feature: GeometryFeature): string | null {
  if (!feature.solidId) return null
  const solid = store.solids.find(s => s.id === feature.solidId)
  if (!solid?.mesh) return null
  const box = new THREE.Box3().setFromObject(solid.mesh)
  if (box.isEmpty()) return null
  const size = box.getSize(new THREE.Vector3())
  return `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} mm`
}

function getFeatureTypeName(type: FeatureType): string {
  const names: Record<FeatureType, string> = {
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
  return names[type] || '未知'
}

function getTypeColor(type: FeatureType): string {
  const colors: Record<FeatureType, string> = {
    [FeatureType.UNKNOWN]: '#909399',
    [FeatureType.FACE]: '#409EFF',
    [FeatureType.EDGE]: '#67C23A',
    [FeatureType.VERTEX]: '#E6A23C',
    [FeatureType.CIRCLE]: '#F56C6C',
    [FeatureType.ARC]: '#F56C6C',
    [FeatureType.LINE]: '#8BC34A',
    [FeatureType.CYLINDER]: '#9C27B0',
    [FeatureType.PLANE]: '#409EFF',
    [FeatureType.SPHERE]: '#00BCD4',
    [FeatureType.CONE]: '#FF9800',
    [FeatureType.TORUS]: '#E91E63'
  }
  return colors[type] || '#909399'
}
</script>

<style lang="scss" scoped>
.info-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  font-size: 13px;

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 3px;
  }
}

.panel-section {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;

  &.measure-hint {
    padding: 8px 12px;
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;

  .el-icon {
    font-size: 14px;
  }
}

.feature-list,
.measurement-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.feature-item,
.measurement-item {
  padding: 6px 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

.feature-header,
.measurement-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.feature-type,
.measurement-type {
  font-weight: 500;
  font-size: 12px;
}

.feature-props {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.prop-item {
  display: flex;
  font-size: 11px;
  color: #606266;

  .prop-label {
    color: #909399;
    width: 48px;
    flex-shrink: 0;
  }

  .prop-value {
    word-break: break-all;
  }
}

.measurement-value {
  font-size: 15px;
  font-weight: 600;
  color: #409EFF;
  text-align: center;
  padding: 4px 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: var(--el-text-color-secondary, #909399);

  p {
    margin: 4px 0;
  }

  .hint {
    font-size: 12px;
    color: var(--el-text-color-placeholder, #c0c4cc);
  }
}

.panel-actions {
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px solid #f0f0f0;
  margin-top: auto;
}
</style>
