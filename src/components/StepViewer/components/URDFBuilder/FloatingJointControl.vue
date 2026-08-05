<template>
  <Teleport to="body">
    <Transition name="fk-panel">
      <div v-show="visible" class="fk-floating-panel" ref="panelRef" @pointerdown="bringToFront">
        <div class="fk-title-bar" ref="handleRef">
          <span class="fk-title">🎛️ 关节控制</span>
          <div class="fk-title-actions">
            <el-button size="small" text @click.stop="urdfStore.resetJoints()">归零</el-button>
            <el-button size="small" text @click.stop="urdfStore.randomizeJoints()">随机</el-button>
            <el-button size="small" text circle @click="$emit('close')">✕</el-button>
          </div>
        </div>

        <div class="fk-body">
          <div v-if="urdfStore.activeJoints.length > 0" class="slider-list">
            <JointSlider v-for="joint in urdfStore.activeJoints" :key="joint.id" :joint="joint" />
          </div>
          <div v-else class="empty-hint">暂无可控关节</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { toRef } from "vue";
import { useURDFStore } from "../../stores/useURDFStore";
import { useFloatingPanel } from "../composables/useFloatingPanel";
import JointSlider from "./JointSlider.vue";

const props = defineProps<{
  visible: boolean;
}>();

defineEmits<{
  (e: "close"): void;
}>();

const urdfStore = useURDFStore();

const { panelRef, handleRef, bringToFront } = useFloatingPanel({
  visible: toRef(props, "visible"),
  initial: ({ width, height }) => ({
    x: Math.max(40, Math.min(width - 360, width * 0.6)),
    y: Math.max(40, height - 460),
  }),
});
</script>

<style lang="scss" scoped>
.fk-floating-panel {
  position: fixed;
  width: 320px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: var(--panel-face);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.fk-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--panel-bar);
  border-bottom: 1px solid var(--line-strong);
  cursor: move;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
}

.fk-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.fk-title-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.fk-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--line-strong);
    border-radius: 2px;
  }
}

.slider-list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-2);
  text-align: center;
  padding: 12px 0;
}

.fk-panel-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fk-panel-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.fk-panel-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.fk-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
