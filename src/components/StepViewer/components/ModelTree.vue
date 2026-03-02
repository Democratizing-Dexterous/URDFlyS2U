<!--
  模型结构树组件（虚拟滚动版）
  仿 SolidWorks 特征管理器 FeatureManager
  支持 Compound → Solid → Edge 层级
  双向联动 + 边缘描边高亮
  使用 el-tree-v2 虚拟化，支持万级节点
-->

<template>
  <div class="model-tree">
    <div class="tree-header">
      <span class="tree-title">模型结构</span>
      <span v-if="store.hasModel" class="tree-count">{{ store.treeNodeCount }} 项</span>
    </div>

    <div v-if="!store.hasModel" class="tree-empty">
      <p>暂无模型</p>
      <p class="hint">请上传 STEP 文件</p>
    </div>

    <div v-else class="tree-content" ref="treeContainerRef">
      <el-tree-v2 ref="treeRef" :data="store.treeNodes" :props="treeProps" :height="treeHeight" :item-size="28"
        :indent="24" :default-expanded-keys="store.expandedTreeNodeIds" :highlight-current="true"
        :expand-on-click-node="false" :current-node-key="currentNodeKey" @node-click="handleNodeClick"
        @node-expand="handleNodeExpand" @node-collapse="handleNodeCollapse">
        <template #default="{ data }">
          <div class="tree-node" :class="{
            'is-selected': store.selectedTreeNodeIdSet.has(data.id),
            'is-solid': data.type === 'solid',
            'is-edge': data.type === 'edge',
            'is-compound': data.type === 'compound' || data.type === 'root'
          }">
            <span class="node-icon">{{ getNodeIcon(data) }}</span>
            <span class="node-label" :title="data.name">{{ data.name }}</span>
            <span v-if="data.children && data.children.length" class="node-count">
              ({{ data.children.length }})
            </span>
          </div>
        </template>
      </el-tree-v2>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { TreeNode } from '../types'
import { useStepViewerStore } from '../stores/useStepViewerStore'

const store = useStepViewerStore()

// 事件
const emit = defineEmits<{
  (e: 'select', node: TreeNode, multi: boolean): void
}>()

const treeRef = ref()
const treeContainerRef = ref<HTMLElement>()
/** el-tree-v2 虚拟滚动必须传数字像素高度，通过 ResizeObserver 跟踪容器实际高度 */
const treeHeight = ref(600)
/** 标记选择来源：树点击时为 true，防止 watcher 反向 scrollTo 导致虚拟列表跳位 */
let selectionFromTree = false


const treeProps = {
  children: 'children',
  label: 'name',
  value: 'id'
}

/** 当前高亮的节点 key */
const currentNodeKey = computed(() => {
  return store.selectedTreeNodeIds[0] || ''
})

/**
 * 获取节点图标
 */
function getNodeIcon(data: TreeNode): string {
  switch (data.type) {
    case 'root': return '📦'
    case 'compound': return '📁'
    case 'solid': return '🧊'
    case 'shell': return '🔲'
    case 'edge': return getEdgeTypeIcon(data.name)
    default: return '📄'
  }
}


function getEdgeTypeIcon(name: string): string {
  if (name.includes('线段') || name.includes('直线')) return '➖'
  if (name.includes('圆弧') || name.includes('圆')) return '➰'
  if (name.includes('椰圆') || name.includes('椭圆')) return '⬭️'
  if (name.includes('B样条') || name.includes('B-Spline')) return '〰️'
  if (name.includes('Bezier') || name.includes('贝塞尔')) return '〰️'
  return '—'
}

/**
 * 处理节点点击 — el-tree-v2 签名: (data, node, e)
 */
function handleNodeClick(data: any, _node: any, e: MouseEvent): void {
  const node = data as TreeNode
  const multi = e?.ctrlKey || e?.shiftKey || false
  // 标记本次选择来自树，watcher 中不需要 scrollTo
  selectionFromTree = true
  emit('select', node, multi)
}

/**
 * 处理节点展开/折叠
 */
function handleNodeExpand(data: any): void {
  const node = data as TreeNode
  if (!store.expandedTreeNodeIds.includes(node.id)) {
    store.expandedTreeNodeIds.push(node.id)
  }
}

function handleNodeCollapse(data: any): void {
  const node = data as TreeNode
  const idx = store.expandedTreeNodeIds.indexOf(node.id)
  if (idx >= 0) {
    store.expandedTreeNodeIds.splice(idx, 1)
  }
}

/**
 * 容器尺寸跟踪（el-tree-v2 需要精确的像素高度）
 */
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    if (treeContainerRef.value) {
      treeHeight.value = Math.max(100, treeContainerRef.value.clientHeight)
      resizeObserver = new ResizeObserver(() => {
        if (treeContainerRef.value) {
          treeHeight.value = Math.max(100, treeContainerRef.value.clientHeight)
        }
      })
      resizeObserver.observe(treeContainerRef.value)
    }
  })
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/**
 * 监听 3D 侧选中变化，同步高亮 + 滚动到对应树节点
 *
 * 核心要点：
 * el-tree-v2 内部 watch(defaultExpandedKeys) 没有 { deep: true }，
 * 所以对 expandedTreeNodeIds 做 .push() 不会触发内部 expandedKeySet 更新。
 * 必须通过 setExpandedKeys() 强制同步内部状态，否则 flattenTree 是错的，
 * scrollTo 定位到错误位置导致列表空白。
 */
watch(() => store.selectedTreeNodeIds, async (ids) => {
  if (!ids.length || !treeRef.value) {
    selectionFromTree = false
    return
  }

  // 选择来自树点击，用户已看到该节点，跳过滚动
  if (selectionFromTree) {
    selectionFromTree = false
    return
  }

  // 滚动目标：优先选择叶子级节点（edge），父级 solid 已展开
  // 如果有边级 ID，直接滚动到该节点；否则取 solid 级
  let scrollTarget = ids.find(id => id.includes('_edge_'))
  if (!scrollTarget) {
    scrollTarget = ids.find(id => !id.includes('_edge_'))
    if (!scrollTarget) scrollTarget = ids[0]
  }

  // ★ 强制同步 el-tree-v2 内部展开状态（.push() 不会触发它的 prop watcher）
  treeRef.value.setExpandedKeys([...store.expandedTreeNodeIds])

  // 等 Vue 响应式 + 虚拟列表重算 flattenTree
  await nextTick()
  await nextTick()

  // 滚动到目标节点（scrollToNode 按 key 查 flattenTree 索引，scrollTo 是像素偏移）
  try {
    treeRef.value?.scrollToNode?.(scrollTarget, 'center')
  } catch {
    // 目标节点不在可见列表中，忽略
  }
}, { flush: 'post' })
</script>

<style scoped lang="scss">
.model-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
  user-select: none;
}

.tree-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter, #e4e7ed);
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);

  .tree-title {
    flex: 1;
  }

  .tree-count {
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-secondary, #909399);
  }
}

.tree-empty {
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

.tree-content {
  flex: 1;
  overflow: hidden;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
  width: 100%;
  min-width: 0;

  &.is-selected {
    background-color: rgba(64, 158, 255, 0.15);
  }

  .node-icon {
    flex-shrink: 0;
    font-size: 14px;
    width: 18px;
    text-align: center;
  }

  .node-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.6;
  }

  .node-count {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--el-text-color-placeholder, #c0c4cc);
    margin-left: 2px;
  }
}

// 覆盖 el-tree-v2 默认样式
:deep(.el-tree) {
  background: transparent;
  --el-tree-node-hover-bg-color: transparent;
}

:deep(.el-tree-node__content) {
  height: auto !important;
  min-height: 28px;
}

:deep(.el-tree-node__expand-icon) {
  font-size: 14px;
  padding: 3px;
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: transparent;
}
</style>
