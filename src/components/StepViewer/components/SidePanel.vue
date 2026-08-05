<template>
  <Teleport to="body">
    <Transition name="model-tree-panel">
      <div
        v-show="visible"
        class="model-tree-panel-overlay"
        ref="panelRef"
        @pointerdown="bringToFront"
      >
        <div class="panel-header" ref="handleRef">
          <span class="panel-title">模型结构</span>
          <el-button size="small" text @click="$emit('close')">✕</el-button>
        </div>

        <ModelTree
          @select="handleTreeSelect"
          @solid-hover="handleSolidHover"
          @toggle-solid-visibility="handleToggleSolidVisibility"
          @split-solid="(id: string) => emit('splitSolid', id)"
          @rename-solid="(id: string) => emit('renameSolid', id)"
          @merge-solids="(ids: string[]) => emit('mergeSolids', ids)"
        />

        <div class="resize-handle" @pointerdown.prevent.stop="startResize" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, toRef } from "vue";
import type { TreeNode } from "../types";
import ModelTree from "./ModelTree.vue";
import { useEdgeResize, useFloatingPanel } from "./composables/useFloatingPanel";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "treeSelect", node: TreeNode, multi: boolean): void;
  (e: "solidHover", solidId: string | null): void;
  (e: "toggleSolidVisibility", solidId: string): void;
  (e: "splitSolid", solidId: string): void;
  (e: "renameSolid", solidId: string): void;
  (e: "mergeSolids", solidIds: string[]): void;
  (e: "close"): void;
}>();

const panelWidth = ref(300);

const RIGHT_COLUMN_WIDTH = 160;
const PROPERTY_PANEL_WIDTH = 300;
const PANEL_TOP_OFFSET = 80;
const PANEL_EDGE_GAP = 12;

const { panelRef, handleRef, bringToFront } = useFloatingPanel({
  visible: toRef(props, "visible"),
  width: panelWidth,
  initial: ({ width }) => ({
    x: Math.max(
      PANEL_EDGE_GAP,
      width - RIGHT_COLUMN_WIDTH - PROPERTY_PANEL_WIDTH - panelWidth.value - PANEL_EDGE_GAP,
    ),
    y: PANEL_TOP_OFFSET,
  }),
});

const { startResize } = useEdgeResize(panelWidth, { min: 220, max: 500 });

function handleTreeSelect(node: TreeNode, multi: boolean): void {
  emit("treeSelect", node, multi);
}

function handleSolidHover(solidId: string | null): void {
  emit("solidHover", solidId);
}

function handleToggleSolidVisibility(solidId: string): void {
  emit("toggleSolidVisibility", solidId);
}
</script>

<style scoped lang="scss">
.model-tree-panel-overlay {
  position: fixed;
  display: flex;
  flex-direction: column;
  height: 70vh;
  max-height: 80vh;
  background: var(--panel-face);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line-strong);
  background: var(--panel-bar);
  flex-shrink: 0;
  cursor: move;
  user-select: none;
  touch-action: none;

  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-1);
    letter-spacing: 0.04em;
  }
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;

  &:hover {
    background: var(--accent);
  }
}

.model-tree-panel-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.model-tree-panel-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.model-tree-panel-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}

.model-tree-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
