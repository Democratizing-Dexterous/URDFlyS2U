<!--
  左侧边栏面板
  仅包含模型结构树
  支持拖拽调整宽度、折叠/展开
-->

<template>
    <div v-show="store.sidePanelVisible" class="side-panel" :style="{ width: `${store.sidePanelWidth}px` }">
        <ModelTree @select="handleTreeSelect" />

        <!-- 拖拽手柄 -->
        <div class="resize-handle" @mousedown="startResize" />
    </div>
</template>

<script setup lang="ts">
import type { TreeNode } from '../types'
import { useStepViewerStore } from '../stores/useStepViewerStore'
import ModelTree from './ModelTree.vue'

const store = useStepViewerStore()

// 事件
const emit = defineEmits<{
    (e: 'tree-select', node: TreeNode, multi: boolean): void
}>()

/**
 * 树选中事件透传
 */
function handleTreeSelect(node: TreeNode, multi: boolean): void {
    emit('tree-select', node, multi)
}

/**
 * 拖拽调整宽度
 */
function startResize(e: MouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = store.sidePanelWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX
        store.setSidePanelWidth(startWidth + delta)
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
.side-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 200px;
    max-width: 500px;
    background: var(--el-bg-color, #fff);
    border-right: 1px solid var(--el-border-color-lighter, #e4e7ed);
    z-index: 10;
    overflow: hidden;
}

.resize-handle {
    position: absolute;
    top: 0;
    right: -3px;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 20;

    &:hover {
        background: var(--el-color-primary-light-7, rgba(64, 158, 255, 0.3));
    }
}
</style>
