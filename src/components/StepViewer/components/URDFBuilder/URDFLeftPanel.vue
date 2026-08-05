<template>
  <div class="urdf-left-panel" :style="{ width: panelWidth + 'px' }">
    <div class="panel-header">
      <span class="panel-title">
        <el-icon>
          <Cpu />
        </el-icon>
        Robot Structure
      </span>
      <div class="panel-header-actions">
        <el-button size="small" :icon="Plus" @click="handleAddRootLink">Add Link</el-button>
      </div>
    </div>

    <div class="panel-content">
      <el-tree
        ref="treeRef"
        :data="urdfStore.treeData"
        node-key="id"
        :default-expand-all="true"
        highlight-current
        :expand-on-click-node="false"
        empty-text="暂无结构，点击 Add Link 创建根连杆"
        @node-click="handleNodeClick"
      >
        <template #default="{ data }">
          <div class="tree-node-row" :class="[data.nodeType, { 'is-base': data.isBase }]">
            <el-icon class="node-icon">
              <Box v-if="data.nodeType === 'link'" />
              <Share v-else />
            </el-icon>

            <el-input
              v-if="editingId === data.id"
              v-model="editingName"
              size="small"
              @blur="finishRename(data)"
              @keydown.enter.stop="finishRename(data)"
              @keydown.escape.stop="cancelRename"
              @click.stop
              autofocus
              class="rename-input"
            />
            <span v-else class="node-label" :title="data.label">{{ data.label }}</span>

            <el-tag v-if="data.isBase" size="small" type="info" class="node-badge">root</el-tag>
            <el-tag
              v-else-if="data.nodeType === 'joint'"
              size="small"
              :type="getJointTagType(data.jointType)"
              class="node-badge"
              >{{ data.jointType }}</el-tag
            >
            <span v-if="data.nodeType === 'link' && data.solidCount > 0" class="solid-count"
              >{{ data.solidCount }}s</span
            >

            <span class="node-spacer" />

            <template v-if="data.nodeType === 'link'">
              <el-tooltip content="添加子 Link" placement="top" :show-after="600">
                <el-button
                  class="node-btn"
                  size="small"
                  text
                  :icon="Plus"
                  @click.stop="handleAddChildLink(data)"
                />
              </el-tooltip>
              <el-tooltip content="绑定 Solid" placement="top" :show-after="600">
                <el-button
                  class="node-btn"
                  size="small"
                  text
                  :icon="Paperclip"
                  @click.stop="handleBindSolid(data)"
                />
              </el-tooltip>
              <el-tooltip content="重命名" placement="top" :show-after="600">
                <el-button
                  class="node-btn"
                  size="small"
                  text
                  :icon="Edit"
                  @click.stop="startRename(data)"
                />
              </el-tooltip>
              <el-tooltip v-if="!data.isBase" content="删除连杆" placement="top" :show-after="600">
                <el-button
                  class="node-btn node-btn--danger"
                  size="small"
                  text
                  :icon="Delete"
                  @click.stop="handleDeleteLink(data)"
                />
              </el-tooltip>
            </template>
            <template v-else>
              <el-tooltip content="重命名" placement="top" :show-after="600">
                <el-button
                  class="node-btn"
                  size="small"
                  text
                  :icon="Edit"
                  @click.stop="startRename(data)"
                />
              </el-tooltip>
              <el-tooltip content="删除关节" placement="top" :show-after="600">
                <el-button
                  class="node-btn node-btn--danger"
                  size="small"
                  text
                  :icon="Delete"
                  @click.stop="handleDeleteJoint(data)"
                />
              </el-tooltip>
            </template>
          </div>
        </template>
      </el-tree>
    </div>

    <div class="controls-section">
      <ViewControls
        @rotate-to-z-up="(up: UpAxis) => $emit('rotateToZUp', up)"
        @reset-orientation="$emit('resetOrientation')"
      />
    </div>

    <div class="panel-footer">
      <el-select v-model="urdfStore.exportFormat" size="default" style="width: 118px">
        <el-option label="URDF" value="urdf" />
        <el-option label="MJCF" value="mjcf" />
        <el-option label="URDF + MJCF" value="both" />
      </el-select>
      <el-button type="success" :icon="Download" @click="$emit('exportUrdf')"> 导出 </el-button>
      <el-button type="primary" :icon="Share" @click="goToURDFCC"> URDF Studio 预览 </el-button>
    </div>

    <div class="resize-handle" @pointerdown.prevent="startResize" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";
import { confirmDialog } from "../../utils/dialog";
import { useEdgeResize } from "../composables/useFloatingPanel";
import { ElMessage } from "element-plus";
import Plus from "~icons/ep/plus";
import Edit from "~icons/ep/edit";
import Delete from "~icons/ep/delete";
import Download from "~icons/ep/download";
import Box from "~icons/ep/box";
import Share from "~icons/ep/share";
import Paperclip from "~icons/ep/paperclip";
import Cpu from "~icons/ep/cpu";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";
import type { URDFTreeNode } from "../../stores/useURDFStore";
import type { JointType } from "../../types";
import ViewControls from "./ViewControls.vue";
import type { UpAxis } from "../../core/ZUpTransform";

defineEmits<{
  (e: "exportUrdf"): void;
  (e: "rotateToZUp", up: UpAxis): void;
  (e: "resetOrientation"): void;
}>();

const urdfStore = useURDFStore();
const stepStore = useStepViewerStore();
const treeRef = ref<any>();
const panelWidth = ref(330);
const { startResize } = useEdgeResize(panelWidth, { min: 200, max: 500 });

const editingId = ref<string | null>(null);
const editingName = ref("");

function guardActiveMode(): boolean {
  if (urdfStore.bindingMode.active) urdfStore.stopBindingMode();
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning("请先点击「✕ 停止拾取」结束关节轴线拾取后再操作");
    return true;
  }
  return false;
}

function handleNodeClick(data: URDFTreeNode): void {
  if (editingId.value) return;
  if (urdfStore.bindingMode.active) {
    if (data.nodeType === "link") {
      urdfStore.selectedLinkId = data.id;
      urdfStore.selectedJointId = null;
      stepStore.setFocusedSolid(null);
      urdfStore.startBindingMode(data.id);
      ElMessage.info(`绑定目标已切换到「${data.label}」`);
      return;
    }
    urdfStore.stopBindingMode();
  }
  if (urdfStore.edgePickEditJointId) {
    if (data.id !== urdfStore.edgePickEditJointId) {
      ElMessage.warning("请先点击「✕ 停止拾取」结束关节轴线拾取后再切换");
    }
    return;
  }
  stepStore.setFocusedSolid(null);
  if (data.nodeType === "link") {
    urdfStore.selectedLinkId = data.id;
    urdfStore.selectedJointId = null;
  } else {
    urdfStore.selectedJointId = data.id;
    urdfStore.selectedLinkId = null;
  }
}

function handleAddRootLink(): void {
  if (guardActiveMode()) return;
  const link = urdfStore.addLink();
  urdfStore.selectedLinkId = link.id;
  urdfStore.selectedJointId = null;
  nextTick(() => treeRef.value?.setCurrentKey(link.id));
}

function handleAddChildLink(data: URDFTreeNode): void {
  if (guardActiveMode()) return;
  if (data.isBase && data.solidCount > 0 && !urdfStore.baseLinkOrigin) {
    ElMessage.warning("请先为 base_link 设置坐标基点（右侧面板 → 自动计算 或 3D 拾取）");
    return;
  }
  const childLink = urdfStore.addLink();
  const result = urdfStore.addJoint({
    type: "revolute",
    parentLinkId: data.id,
    childLinkId: childLink.id,
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 0, 1],
  });
  if (!result.ok) {
    urdfStore.removeLink(childLink.id);
    ElMessage.warning(result.reason);
    return;
  }
  urdfStore.selectedJointId = result.joint.id;
  urdfStore.selectedLinkId = null;
  nextTick(() => treeRef.value?.setCurrentKey(result.joint.id));
}

function handleBindSolid(data: URDFTreeNode): void {
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning("请先点击「✕ 停止拾取」结束关节轴线拾取后再操作");
    return;
  }
  urdfStore.selectedLinkId = data.id;
  urdfStore.selectedJointId = null;
  stepStore.setFocusedSolid(null);
  nextTick(() => treeRef.value?.setCurrentKey(data.id));
  urdfStore.startBindingMode(data.id);
}

function startRename(data: URDFTreeNode): void {
  editingId.value = data.id;
  editingName.value = data.label;
}

function finishRename(data: URDFTreeNode): void {
  const name = editingName.value.trim();
  if (name) {
    const result =
      data.nodeType === "link"
        ? urdfStore.renameLink(data.id, name)
        : urdfStore.renameJoint(data.id, name);
    if (!result.ok) {
      ElMessage.warning(result.reason);
      return;
    }
  }
  editingId.value = null;
}

function cancelRename(): void {
  editingId.value = null;
}

function handleDeleteLink(data: URDFTreeNode): void {
  if (guardActiveMode()) return;
  confirmDialog(`确定删除连杆 "${data.label}"？关联的关节将被级联删除。`, "删除确认", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消",
  })
    .then(() => {
      const result = urdfStore.removeLink(data.id);
      if (!result.ok) {
        ElMessage.warning(result.reason!);
      } else {
        nextTick(() => treeRef.value?.setCurrentKey(""));
      }
    })
    .catch(() => undefined);
}

function handleDeleteJoint(data: URDFTreeNode): void {
  if (guardActiveMode()) return;
  urdfStore.removeJoint(data.id);
  nextTick(() => treeRef.value?.setCurrentKey(""));
}

function getJointTagType(type?: JointType): "primary" | "success" | "info" | "warning" | "danger" {
  const map: Record<string, "primary" | "success" | "info" | "warning" | "danger"> = {
    revolute: "primary",
    prismatic: "success",
    fixed: "info",
    continuous: "primary",
    ball: "warning",
    planar: "success",
    floating: "danger",
  };
  return map[type ?? ""] ?? "info";
}

function setCurrentNodeById(id: string): void {
  treeRef.value?.setCurrentKey(id);
}
function goToURDFCC(): void {
  const url = `https://urdf.d-robotics.cc/`;
  window.open(url, "_blank");
}
defineExpose({ setCurrentNodeById });
</script>

<style lang="scss" scoped>
.urdf-left-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 200px;
  max-width: 500px;
  background: var(--surface-1);
  border-right: 1px solid var(--line);
  z-index: 10;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  min-height: 45px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  flex-shrink: 0;

  .panel-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-1);
    letter-spacing: 0.055em;
    text-transform: uppercase;
  }

  .panel-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.panel-content {
  flex: 7;
  overflow-y: auto;
  padding: 6px 0;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #bcc4be;
    border-radius: 2px;
  }

  :deep(.el-tree) {
    font-size: 12px;
    --el-tree-node-hover-bg-color: #242a2a;
    background: transparent;
  }

  :deep(.el-tree-node__content) {
    height: auto;
    min-height: 28px;
    padding-right: 4px;
  }
}

.controls-section {
  flex: 3;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--line);
  padding: 4px 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #bcc4be;
    border-radius: 2px;
  }
}

.tree-node-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 3px;
  padding: 1px 0;
  min-width: 0;

  &.link .node-icon {
    color: #7ec8e8;
  }

  &.joint .node-icon {
    color: var(--accent);
  }

  &.is-base .node-icon {
    color: var(--success);
  }
}

.node-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.node-label {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.rename-input {
  width: 100px;
  flex-shrink: 0;
}

.node-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 16px;
}

.solid-count {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-3);
  background: var(--surface-3);
  padding: 0 4px;
  border-radius: 3px;
}

.node-spacer {
  flex: 1;
}

.node-btn {
  flex-shrink: 0;
  padding: 1px !important;
  height: 20px !important;
  width: 20px !important;
  min-height: unset !important;

  :deep(.el-icon) {
    font-size: 11px;
  }

  &:hover {
    background: rgba(255, 173, 50, 0.12) !important;
    color: var(--accent) !important;
  }
}

.node-btn--danger:hover {
  background: #fef0f0 !important;
  color: #f56c6c !important;
}

.panel-footer {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  flex-shrink: 0;

  .el-button {
    flex: 1;
  }
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
    background: var(--accent);
  }
}
</style>
