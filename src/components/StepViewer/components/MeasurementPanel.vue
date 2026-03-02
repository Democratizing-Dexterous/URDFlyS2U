<!--
  独立测量面板
  固定显示在侧边栏「测量」标签页中
  根据选中特征动态显示可用操作
-->

<template>
  <div class="measurement-panel">
    <!-- 测量操作区 -->
    <div class="panel-section">
      <h3 class="section-title">
        <el-icon>
          <component :is="RulerIcon" />
        </el-icon>
        测量工具
      </h3>

      <!-- 选中提示 -->
      <div class="measure-hint">
        <el-alert :title="measureHint" type="info" :closable="false" show-icon />
      </div>

      <!-- 操作按钮 -->
      <div class="measure-actions" v-if="store.selectedFeatures.length > 0">
        <el-button v-if="store.selectedFeatures.length === 1 && hasRadius" type="primary"
          @click="emit('measureRadius')">
          测量半径
        </el-button>
        <el-button v-if="store.selectedFeatures.length === 1 && hasRadius" type="primary"
          @click="emit('measureDiameter')">
          测量直径
        </el-button>
        <el-button v-if="store.selectedFeatures.length === 2 && bothAreEdges" type="primary"
          @click="emit('measureDistance')">
          测量距离
        </el-button>
        <el-button v-if="store.selectedFeatures.length === 2 && bothHaveNormals" type="primary"
          @click="emit('measureAngle')">
          测量角度
        </el-button>
      </div>
    </div>

    <!-- 测量结果 -->
    <div class="panel-section" v-if="store.measurements.length > 0">
      <div class="results-header">
        <h3 class="section-title">
          测量结果 ({{ store.measurements.length }})
        </h3>
        <el-button type="danger" text @click="emit('clearMeasurements')">
          全部清除
        </el-button>
      </div>
      <div class="measurement-list">
        <div v-for="measurement in store.measurements" :key="measurement.id" class="measurement-item">
          <div class="measurement-header">
            <span class="measurement-type">{{ getMeasurementTypeName(measurement.type) }}</span>
            <el-button type="danger" text @click="emit('removeMeasurement', measurement.id)">
              删除
            </el-button>
          </div>
          <div class="measurement-value">
            {{ measurement.label }}
          </div>
        </div>
      </div>
    </div>

    <!-- 画线测量结果 -->
    <div class="panel-section" v-if="store.lineMeasurements.length > 0">
      <div class="results-header">
        <h3 class="section-title">
          画线测量 ({{ store.lineMeasurements.length }})
        </h3>
        <el-button type="danger" text @click="emit('clearLineMeasurements')">
          全部清除
        </el-button>
      </div>
      <div class="measurement-list">
        <div v-for="(line, idx) in store.lineMeasurements" :key="line.id"
          class="measurement-item line-measurement-item">
          <div class="measurement-header">
            <span class="measurement-type">画线 #{{ idx + 1 }}</span>
            <el-button type="danger" text @click="emit('removeLineMeasurement', line.id)">
              删除
            </el-button>
          </div>
          <div class="measurement-value">
            {{ line.label }}
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state"
      v-if="store.selectedFeatures.length === 0 && store.measurements.length === 0 && store.lineMeasurements.length === 0">
      <p>选择特征后可进行测量</p>
      <p class="hint">支持距离、角度、半径、直径、画线测量</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import type { MeasurementType } from '../types'
import { useStepViewerStore } from '../stores/useStepViewerStore'

const store = useStepViewerStore()

// 自定义 Ruler 图标
const RulerIcon = {
  name: 'RulerIcon',
  setup() {
    return () => h('svg', { viewBox: '0 0 1024 1024' }, [
      h('path', {
        fill: 'currentColor',
        d: 'M867.584 156.416L156.416 867.584a64 64 0 0 0 0 90.496l45.248 45.248a64 64 0 0 0 90.496 0L1003.328 292.16a64 64 0 0 0 0-90.496l-45.248-45.248a64 64 0 0 0-90.496 0zM224 448l64-64-64-64 64-64-64-64 128-128 64 64-64 64 64 64-64 64 64 64-128 128zm192 192l64-64-64-64 64-64-64-64 128-128 64 64-64 64 64 64-64 64 64 64-128 128zm192 192l64-64-64-64 64-64-64-64 128-128 64 64-64 64 64 64-64 64 64 64-128 128z'
      })
    ])
  }
}

const emit = defineEmits<{
  (e: 'measureRadius'): void
  (e: 'measureDiameter'): void
  (e: 'measureDistance'): void
  (e: 'measureAngle'): void
  (e: 'removeMeasurement', id: string): void
  (e: 'clearMeasurements'): void
  (e: 'removeLineMeasurement', id: string): void
  (e: 'clearLineMeasurements'): void
}>()

const hasRadius = computed(() => {
  return store.selectedFeatures.length === 1 &&
    store.selectedFeatures[0].radius !== undefined
})

const bothAreEdges = computed(() => {
  return store.selectedFeatures.length === 2 &&
    store.selectedFeatures[0].edgeIndex !== undefined &&
    store.selectedFeatures[1].edgeIndex !== undefined
})

const bothHaveNormals = computed(() => {
  return store.selectedFeatures.length === 2 &&
    store.selectedFeatures[0].normal &&
    store.selectedFeatures[1].normal
})

const measureHint = computed(() => {
  const count = store.selectedFeatures.length
  if (count === 0) {
    return '点击模型选择特征'
  } else if (count === 1) {
    return '已选 1 个特征，可测量半径/直径，或选第二个边测量距离'
  } else {
    return `已选 ${count} 个特征，可进行测量`
  }
})

function getMeasurementTypeName(type: MeasurementType): string {
  const names: Record<string, string> = {
    distance: '距离',
    angle: '角度',
    radius: '半径',
    diameter: '直径',
    length: '长度',
    area: '面积'
  }
  return names[type] || type
}
</script>

<style lang="scss" scoped>
.measurement-panel {
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

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;

  .section-title {
    margin: 0;
  }
}

.measure-hint {
  margin-bottom: 10px;
}

.measure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.measurement-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.measurement-item {
  padding: 6px 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

.measurement-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.measurement-type {
  font-weight: 500;
  font-size: 12px;
}

.measurement-value {
  font-size: 15px;
  font-weight: 600;
  color: #409EFF;
  text-align: center;
  padding: 4px 0;
}

.line-measurement-item {
  border-left: 3px solid #E6A23C;
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
</style>
