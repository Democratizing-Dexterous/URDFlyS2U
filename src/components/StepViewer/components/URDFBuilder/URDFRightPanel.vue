<template>
  <div class="urdf-right-panel">

    <!-- ===== 上半：FK 关节控制 ===== -->
    <div class="panel-section" :class="fkCollapsed ? 'collapsed' : 'expanded'">
      <div class="section-header" @click="fkCollapsed = !fkCollapsed">
        <span class="section-title">🎛️ 关节控制</span>
        <div class="header-right">
          <template v-if="!fkCollapsed">
            <el-button size="small" text @click.stop="urdfStore.resetJoints()">归零</el-button>
            <el-button size="small" text @click.stop="urdfStore.randomizeJoints()">随机</el-button>
          </template>
          <el-icon class="collapse-arrow">
            <ArrowDown v-if="!fkCollapsed" />
            <ArrowRight v-else />
          </el-icon>
        </div>
      </div>
      <div v-show="!fkCollapsed" class="section-body">
        <div v-if="urdfStore.activeJoints.length > 0" class="slider-list">
          <JointSlider v-for="joint in urdfStore.activeJoints" :key="joint.id" :joint="joint" />
        </div>
        <div v-else class="empty-hint">暂无可控关节（Fixed 不可控）</div>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="section-divider" />

    <!-- ===== 下半：上下文属性面板 ===== -->
    <div class="panel-section" :class="propCollapsed ? 'collapsed' : 'expanded'">
      <div class="section-header" @click="propCollapsed = !propCollapsed">
        <span class="section-title">{{ contextTitle }}</span>
        <el-icon class="collapse-arrow">
          <ArrowDown v-if="!propCollapsed" />
          <ArrowRight v-else />
        </el-icon>
      </div>
      <div v-show="!propCollapsed" class="section-body">
        <URDFJointProperties v-if="urdfStore.selectedJointId" @flip-normal="$emit('flipNormal')" />
        <URDFLinkProperties v-else-if="urdfStore.selectedLinkId" />
        <div v-else class="empty-hint context-empty">
          <el-icon style="font-size: 24px; color: #dcdfe6">
            <Connection />
          </el-icon>
          <p>点击左侧树节点</p>
          <p>查看或编辑属性</p>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowDown, ArrowRight, Connection } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import JointSlider from './JointSlider.vue'
import URDFJointProperties from './URDFJointProperties.vue'
import URDFLinkProperties from './URDFLinkProperties.vue'

const emit = defineEmits<{
  (e: 'flipNormal'): void
}>()

const urdfStore = useURDFStore()

const fkCollapsed = ref(false)
const propCollapsed = ref(false)

const contextTitle = computed(() => {
  if (urdfStore.selectedJointId) {
    const j = urdfStore.jointMap.get(urdfStore.selectedJointId)
    return `⚙️ ${j?.name ?? 'Joint 属性'}`
  }
  if (urdfStore.selectedLinkId) {
    const l = urdfStore.linkMap.get(urdfStore.selectedLinkId)
    return `📦 ${l?.name ?? 'Link 属性'}`
  }
  return '📋 属性面板'
})
</script>

<style lang="scss" scoped>
.urdf-right-panel {
  width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  overflow: hidden;
  flex-shrink: 0;
}

/* ——— 面板区域 ——— */
.panel-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 36px;
  transition: flex 0.2s ease;

  &.expanded {
    flex: 1;
  }

  &.collapsed {
    flex: 0 0 36px;
  }
}

.section-divider {
  flex-shrink: 0;
  height: 1px;
  background: #e4e7ed;
}

/* ——— 区域标题 ——— */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  height: 36px;
  background: #fafafa;
  border-bottom: 1px solid #f0f2f5;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;

  &:hover {
    background: #f4f6f9;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #303133;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .collapse-arrow {
    font-size: 12px;
    color: #909399;
    margin-left: 4px;
  }
}

/* ——— 区域内容 ——— */
.section-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #dcdfe6;
    border-radius: 2px;
  }
}

.slider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-hint {
  font-size: 12px;
  color: #909399;
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
    color: #c0c4cc;
  }
}
</style>
