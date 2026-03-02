<!--
  右侧信息面板
  上方：属性信息（InfoPanel）
  下方：测量工具（MeasurementPanel）
  两个面板上下排列，始终可见
  支持拖拽调整宽度
-->

<template>
    <div v-show="visible" class="right-panel" :style="{ width: `${panelWidth}px` }">
        <!-- 拖拽手柄（左侧） -->
        <div class="resize-handle" @mousedown="startResize" />

        <!-- 上方：属性信息 -->
        <div class="panel-top">
            <InfoPanel @remove-feature="(id: string) => emit('removeFeature', id)" />
        </div>

        <!-- 分隔线 -->
        <div class="panel-divider" />

        <!-- 下方：测量工具 -->
        <div class="panel-bottom">
            <MeasurementPanel @measure-radius="emit('measureRadius')" @measure-diameter="emit('measureDiameter')"
                @measure-distance="emit('measureDistance')" @measure-angle="emit('measureAngle')"
                @remove-measurement="(id: string) => emit('removeMeasurement', id)"
                @clear-measurements="emit('clearMeasurements')"
                @remove-line-measurement="(id: string) => emit('removeLineMeasurement', id)"
                @clear-line-measurements="emit('clearLineMeasurements')" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import InfoPanel from './InfoPanel.vue'
import MeasurementPanel from './MeasurementPanel.vue'

const props = withDefaults(defineProps<{
    visible?: boolean
}>(), {
    visible: true
})

const emit = defineEmits<{
    (e: 'removeFeature', id: string): void
    (e: 'removeMeasurement', id: string): void
    (e: 'measureRadius'): void
    (e: 'measureDiameter'): void
    (e: 'measureDistance'): void
    (e: 'measureAngle'): void
    (e: 'clearMeasurements'): void
    (e: 'removeLineMeasurement', id: string): void
    (e: 'clearLineMeasurements'): void
}>()

const panelWidth = ref(280)

/**
 * 拖拽调整宽度（从左侧拖拽）
 */
function startResize(e: MouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth.value

    const onMouseMove = (moveEvent: MouseEvent) => {
        // 左侧拖拽：鼠标向左移动增大宽度
        const delta = startX - moveEvent.clientX
        panelWidth.value = Math.max(200, Math.min(500, startWidth + delta))
    }

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
}
</script>

<style scoped lang="scss">
.right-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 200px;
    max-width: 500px;
    background: var(--el-bg-color, #fff);
    border-left: 1px solid var(--el-border-color-lighter, #e4e7ed);
    z-index: 10;
    overflow: hidden;
}

.panel-top {
    flex: 1;
    min-height: 120px;
    overflow: hidden;
}

.panel-divider {
    height: 1px;
    background: var(--el-border-color-lighter, #e4e7ed);
    flex-shrink: 0;
}

.panel-bottom {
    flex: 1;
    min-height: 120px;
    overflow: hidden;
}

.resize-handle {
    position: absolute;
    top: 0;
    left: -3px;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 20;

    &:hover {
        background: var(--el-color-primary-light-7, rgba(64, 158, 255, 0.3));
    }
}
</style>
