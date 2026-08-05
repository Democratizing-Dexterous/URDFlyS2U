<template>
  <div class="model-tree">
    <div class="tree-header" v-if="store.hasModel">
      <span class="tree-count">{{ store.treeNodeCount }} 项</span>
      <span class="tree-tip">Ctrl / Shift 多选，拖到另一个 Solid 上合并</span>
      <el-button
        v-if="selectedSolidIds.length >= 2"
        class="tree-merge"
        size="small"
        type="warning"
        plain
        @click="handleMerge"
      >
        合并所选（{{ selectedSolidIds.length }}）
      </el-button>
    </div>

    <div v-if="!store.hasModel" class="tree-empty">
      <p>暂无模型</p>
      <p class="hint">请上传 STEP / STL 文件</p>
    </div>

    <div v-else class="tree-content" ref="treeContainerRef">
      <el-tree-v2
        ref="treeRef"
        :data="store.treeNodes"
        :props="treeProps"
        :height="treeHeight"
        :item-size="28"
        :indent="24"
        :default-expanded-keys="store.expandedTreeNodeIds"
        :highlight-current="true"
        :expand-on-click-node="false"
        :current-node-key="currentNodeKey"
        @node-click="handleNodeClick"
        @node-expand="handleNodeExpand"
        @node-collapse="handleNodeCollapse"
      >
        <template #default="{ data }">
          <div
            class="tree-node"
            :class="{
              'is-selected': store.selectedTreeNodeIdSet.has(data.id),
              'is-solid': data.type === 'solid',
              'is-edge': data.type === 'edge',
              'is-compound': data.type === 'compound' || data.type === 'root',
              'is-dragging': isDragSource(data),
              'is-drop-target': dropTargetId === data.id,
            }"
            :draggable="data.type === 'solid'"
            @mouseenter="handleNodeMouseEnter(data)"
            @mouseleave="handleNodeMouseLeave"
            @dragstart="handleDragStart(data, $event)"
            @dragover="handleDragOver(data, $event)"
            @dragleave="handleDragLeave(data)"
            @drop="handleDrop(data, $event)"
            @dragend="resetDrag"
          >
            <span class="node-icon">{{ getNodeIcon(data) }}</span>
            <span
              class="node-label"
              :title="data.type === 'solid' ? `${data.name}（双击重命名）` : data.name"
              @dblclick.stop="data.type === 'solid' && handleRename(data)"
              >{{ data.name }}</span
            >
            <span v-if="data.children && data.children.length" class="node-count">
              ({{ data.children.length }})
            </span>
            <span
              v-if="data.type === 'solid'"
              class="node-split"
              title="重命名 Solid"
              @click.stop="handleRename(data)"
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            <span
              v-if="data.type === 'solid'"
              class="node-split"
              title="按连通面片拆解为多个 Solid"
              @click.stop="handleSplit(data)"
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <line x1="20" y1="4" x2="8.12" y2="15.88" />
                <line x1="14.47" y1="14.48" x2="20" y2="20" />
                <line x1="8.12" y1="8.12" x2="12" y2="12" />
              </svg>
            </span>
            <span
              v-if="data.type === 'solid'"
              class="node-visibility"
              :class="{ 'is-hidden': !isSolidVisible(data) }"
              @click.stop="handleToggleVisibility(data)"
              :title="isSolidVisible(data) ? '隐藏' : '显示'"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <template v-if="isSolidVisible(data)">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </template>
                <template v-else>
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"
                  />
                  <path
                    d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </template>
              </svg>
            </span>
          </div>
        </template>
      </el-tree-v2>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import type { TreeNode } from "../types";
import { useStepViewerStore } from "../stores/useStepViewerStore";
import { useURDFStore } from "../stores/useURDFStore";

const store = useStepViewerStore();
const urdfStore = useURDFStore();

const emit = defineEmits<{
  (e: "select", node: TreeNode, multi: boolean): void;
  (e: "solidHover", solidId: string | null): void;
  (e: "toggleSolidVisibility", solidId: string): void;
  (e: "splitSolid", solidId: string): void;
  (e: "renameSolid", solidId: string): void;
  (e: "mergeSolids", solidIds: string[]): void;
}>();

const treeRef = ref();
const treeContainerRef = ref<HTMLElement>();
const treeHeight = ref(Math.max(200, Math.floor(window.innerHeight * 0.7 - 80)));
let selectionFromTree = false;

const treeProps = {
  children: "children",
  label: "name",
  value: "id",
};

const currentNodeKey = computed(() => {
  const ids = store.selectedTreeNodeIds;
  return (
    ids.find((id) => store.flatTreeNodeMap.get(id)?.type === "solid") ||
    ids.find((id) => store.flatTreeNodeMap.get(id)?.type === "edge") ||
    ids[0] ||
    ""
  );
});

const selectedSolidIds = computed(() => store.selectedSolidIds);

function handleMerge(): void {
  if (selectedSolidIds.value.length >= 2) emit("mergeSolids", selectedSolidIds.value);
}

const dragSourceIds = ref<string[]>([]);
const dropTargetId = ref("");

function mergeTargetId(node: TreeNode): string | null {
  if (dragSourceIds.value.length === 0) return null;
  const targetId = store.solidIdOfNode(node);
  if (!targetId || dragSourceIds.value.includes(targetId)) return null;
  const owners = new Set<string>();
  for (const id of [targetId, ...dragSourceIds.value]) {
    const linkId = urdfStore.solidLinkMap.get(id);
    if (linkId) owners.add(linkId);
  }
  return owners.size <= 1 ? targetId : null;
}

function isDragSource(node: TreeNode): boolean {
  const solidId = store.solidIdOfNode(node);
  return !!solidId && dragSourceIds.value.includes(solidId);
}

function resetDrag(): void {
  dragSourceIds.value = [];
  dropTargetId.value = "";
}

function handleDragStart(node: TreeNode, e: DragEvent): void {
  const solidId = store.solidIdOfNode(node);
  if (!solidId) {
    e.preventDefault();
    return;
  }
  const selected = selectedSolidIds.value;
  dragSourceIds.value = selected.includes(solidId) ? selected.slice() : [solidId];
  dropTargetId.value = "";
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragSourceIds.value.join(","));
  }
}

function handleDragOver(node: TreeNode, e: DragEvent): void {
  if (!mergeTargetId(node)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropTargetId.value = node.id;
}

function handleDragLeave(node: TreeNode): void {
  if (dropTargetId.value === node.id) dropTargetId.value = "";
}

function handleDrop(node: TreeNode, e: DragEvent): void {
  const targetId = mergeTargetId(node);
  if (!targetId) return;
  e.preventDefault();
  const ids = [targetId, ...dragSourceIds.value];
  resetDrag();
  emit("mergeSolids", ids);
}

function getNodeIcon(data: TreeNode): string {
  switch (data.type) {
    case "root":
      return "📦";
    case "compound":
      return "📁";
    case "solid":
      return "🧊";
    case "shell":
      return "🔲";
    case "edge":
      return getEdgeTypeIcon(data.name);
    default:
      return "📄";
  }
}

function getEdgeTypeIcon(name: string): string {
  if (name.includes("线段") || name.includes("直线")) return "➖";
  if (name.includes("圆弧") || name.includes("圆")) return "➰";
  if (name.includes("椰圆") || name.includes("椭圆")) return "⬭️";
  if (name.includes("B样条") || name.includes("B-Spline")) return "〰️";
  if (name.includes("Bezier") || name.includes("贝塞尔")) return "〰️";
  return "—";
}

function handleNodeClick(node: TreeNode, _node: unknown, e: MouseEvent): void {
  const multi = e?.ctrlKey || e?.shiftKey || false;
  selectionFromTree = true;
  emit("select", node, multi);
}

function handleNodeExpand(node: TreeNode): void {
  if (!store.expandedTreeNodeIds.includes(node.id)) {
    store.expandedTreeNodeIds.push(node.id);
  }
}

function handleNodeCollapse(node: TreeNode): void {
  const idx = store.expandedTreeNodeIds.indexOf(node.id);
  if (idx >= 0) {
    store.expandedTreeNodeIds.splice(idx, 1);
  }
}

let hoveredSolidId: string | null = null;
let hoverRafId = 0;

function handleNodeMouseEnter(node: TreeNode): void {
  if (node.type !== "solid" || node.solidIndex === undefined) {
    if (hoveredSolidId !== null) {
      hoveredSolidId = null;
      cancelAnimationFrame(hoverRafId);
      emit("solidHover", null);
    }
    return;
  }
  const solidId = store.solidIdOfNode(node);
  if (!solidId || solidId === hoveredSolidId) return;
  hoveredSolidId = solidId;
  cancelAnimationFrame(hoverRafId);
  hoverRafId = requestAnimationFrame(() => {
    emit("solidHover", hoveredSolidId);
  });
}

function handleNodeMouseLeave(): void {
  if (hoveredSolidId !== null) {
    hoveredSolidId = null;
    cancelAnimationFrame(hoverRafId);
    emit("solidHover", null);
  }
}

function handleToggleVisibility(node: TreeNode): void {
  const solidId = store.solidIdOfNode(node);
  if (solidId) emit("toggleSolidVisibility", solidId);
}

function handleRename(node: TreeNode): void {
  emit("renameSolid", store.solidIdOfNode(node) ?? node.id);
}

function handleSplit(node: TreeNode): void {
  const solidId = store.solidIdOfNode(node);
  if (solidId) emit("splitSolid", solidId);
}

function isSolidVisible(node: TreeNode): boolean {
  const solidId = store.solidIdOfNode(node);
  return solidId ? store.isSolidVisible(solidId) : true;
}

function findAncestorIds(targetId: string): string[] {
  const ancestors: string[] = [];
  const find = (nodes: TreeNode[], path: string[]): boolean => {
    for (const node of nodes) {
      if (node.id === targetId) {
        ancestors.push(...path);
        return true;
      }
      if (node.children) {
        path.push(node.id);
        if (find(node.children, path)) return true;
        path.pop();
      }
    }
    return false;
  };
  find(store.treeNodes, []);
  return ancestors;
}

function handleWindowResize() {
  nextTick(() => {
    if (treeContainerRef.value) {
      const h = treeContainerRef.value.clientHeight;
      if (h > 100) treeHeight.value = h;
    }
  });
}

onMounted(() => {
  nextTick(() => {
    if (treeContainerRef.value) {
      const h = treeContainerRef.value.clientHeight;
      if (h > 100) treeHeight.value = h;
    }
  });
  window.addEventListener("resize", handleWindowResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleWindowResize);
});

watch(
  () => store.selectedTreeNodeIds,
  async (ids) => {
    if (!ids.length || !treeRef.value) {
      selectionFromTree = false;
      return;
    }

    if (selectionFromTree) {
      selectionFromTree = false;
      return;
    }

    let scrollTarget = ids.find((id) => id.includes("_edge_"));
    if (!scrollTarget) {
      scrollTarget = ids.find((id) => /^solid_\d+$/.test(id));
      if (!scrollTarget) scrollTarget = ids[0];
    }

    const ancestors = findAncestorIds(scrollTarget);
    for (const id of ancestors) {
      if (!store.expandedTreeNodeIds.includes(id)) {
        store.expandedTreeNodeIds.push(id);
      }
    }

    treeRef.value.setExpandedKeys([...store.expandedTreeNodeIds]);

    await nextTick();
    await nextTick();

    treeRef.value.scrollToNode(scrollTarget, "center");
  },
  { flush: "post" },
);
</script>

<style scoped lang="scss">
.model-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

  .tree-tip {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    font-weight: 400;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-merge {
    flex-shrink: 0;
  }

  .tree-count {
    flex-shrink: 0;
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
  padding: 2px 12px 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
  width: 100%;
  min-width: 0;

  &.is-selected {
    background-color: rgba(232, 138, 22, 0.15);
  }

  &.is-dragging {
    opacity: 0.45;
  }

  &.is-drop-target {
    background-color: rgba(230, 162, 60, 0.22);
    outline: 1px dashed #e6a23c;
    outline-offset: -1px;
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

  .node-split {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-2);
    opacity: 0;
    margin-left: 2px;
    padding: 2px;
    border-radius: 3px;
    transition:
      opacity 0.15s,
      color 0.15s,
      background-color 0.15s;

    &:hover {
      background-color: rgba(103, 194, 58, 0.14);
      color: #67c23a;
    }
  }

  &:hover .node-split {
    opacity: 1;
  }

  .node-visibility {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-2);
    opacity: 0.5;
    margin-left: 4px;
    padding: 2px;
    border-radius: 3px;
    transition:
      opacity 0.15s,
      color 0.15s,
      background-color 0.15s;

    &:hover {
      background-color: rgba(232, 138, 22, 0.1);
      color: var(--accent);
      opacity: 1;
    }

    &.is-hidden {
      opacity: 0.6;
      color: var(--text-3);
    }
  }

  &:hover .node-visibility {
    opacity: 1;
  }
}

:deep(.el-tree) {
  background: transparent;
  --el-tree-node-hover-bg-color: transparent;
}

:deep(.el-tree-node__content) {
  height: 28px;
}

:deep(.el-tree-node__expand-icon) {
  font-size: 14px;
  padding: 3px;
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: transparent;
}
</style>
