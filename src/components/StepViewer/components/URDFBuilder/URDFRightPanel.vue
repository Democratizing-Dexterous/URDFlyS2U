<template>
  <div class="urdf-right-panel">
    <div class="panel-section expanded">
      <div class="section-header">
        <span class="section-title">{{ contextTitle }}</span>
      </div>
      <div class="section-body">
        <URDFJointProperties v-if="urdfStore.selectedJointId" />
        <URDFLinkProperties v-else-if="urdfStore.selectedLinkId" />
        <div v-else class="empty-hint context-empty">
          <el-icon style="font-size: 24px; color: var(--text-3)">
            <Connection />
          </el-icon>
          <p>点击左侧树节点</p>
          <p>查看或编辑属性</p>
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <div class="panel-section loops-section">
      <div class="section-header">
        <span class="section-title">闭链 / 约束</span>
      </div>
      <div class="section-body">
        <LoopsModule />
      </div>
    </div>

    <div class="section-divider" />

    <div class="panel-section collision-section">
      <div class="section-header">
        <span class="section-title">碰撞体简化</span>
        <el-tag v-if="urdfStore.collisionShapes.length" size="small" type="success">
          {{ urdfStore.collisionShapes.length }}
        </el-tag>
      </div>
      <div class="section-body">
        <CollisionModule />
      </div>
    </div>

    <div class="section-divider" />

    <div class="fk-launch-bar">
      <el-button type="primary" plain @click="$emit('toggleFKPanel')"> 关节控制面板 </el-button>
      <span v-if="urdfStore.activeJoints.length" class="fk-count"
        >{{ urdfStore.activeJoints.length }} 个可控关节</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Connection from "~icons/ep/connection";
import { useURDFStore } from "../../stores/useURDFStore";
import URDFJointProperties from "./URDFJointProperties.vue";
import URDFLinkProperties from "./URDFLinkProperties.vue";
import LoopsModule from "./LoopsModule.vue";
import CollisionModule from "./CollisionModule.vue";

defineEmits<{
  (e: "toggleFKPanel"): void;
}>();

const urdfStore = useURDFStore();

const contextTitle = computed(() => {
  if (urdfStore.selectedJointId) {
    const j = urdfStore.jointMap.get(urdfStore.selectedJointId);
    return `${j?.name ?? "Joint 属性"}`;
  }
  if (urdfStore.selectedLinkId) {
    const l = urdfStore.linkMap.get(urdfStore.selectedLinkId);
    return `${l?.name ?? "Link 属性"}`;
  }
  return "属性面板";
});
</script>

<style lang="scss" scoped>
.urdf-right-panel {
  width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border-left: 1px solid var(--line);
  overflow: hidden;
  flex-shrink: 0;
}

.panel-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 36px;

  &.expanded {
    flex: 1;
  }
}

.loops-section {
  max-height: 40%;
  flex-shrink: 0;
}

.collision-section {
  max-height: 46%;
  flex-shrink: 0;
}

.section-divider {
  flex-shrink: 0;
  height: 1px;
  background: var(--line);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  height: 44px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  user-select: none;
  flex-shrink: 0;

  .section-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--text-1);
    letter-spacing: 0.055em;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
}

.section-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #bcc4be;
    border-radius: 2px;
  }
}

.empty-hint {
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  padding: 12px 0;
}

.context-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 0;

  p {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
}

.fk-launch-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-top: 1px solid var(--line);

  .fk-count {
    font-size: 11px;
    color: var(--text-3);
  }
}
</style>
