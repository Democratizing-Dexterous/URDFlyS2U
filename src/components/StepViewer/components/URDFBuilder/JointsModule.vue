<template>
  <div class="joints-module">
    <div class="module-header">
      <span class="module-title">⚙️ Joints</span>
      <el-button size="small" type="primary" text @click="handleAddJoint" :disabled="urdfStore.robot.links.length < 2">
        + Add Joint
      </el-button>
    </div>

    <div class="joint-list">
      <div v-for="joint in urdfStore.robot.joints" :key="joint.id" class="joint-item"
        :class="{ active: urdfStore.selectedJointId === joint.id }" @click="handleSelectJoint(joint.id)"
        @mouseenter="hoverJointId = joint.id" @mouseleave="hoverJointId = null">
        <div class="joint-main">
          <span class="joint-icon">{{ getJointIcon(joint.type) }}</span>
          <span class="joint-name" :title="joint.name">{{ joint.name }}</span>
        </div>

        <div class="joint-meta">
          <el-select v-model="joint.type" size="small" style="width: 90px" @click.stop
            @change="(val: any) => handleTypeChange(joint.id, val)">
            <el-option label="Revolute" value="revolute" />
            <el-option label="Prismatic" value="prismatic" />
            <el-option label="Fixed" value="fixed" />
            <el-option label="Continuous" value="continuous" />
          </el-select>

          <el-button v-show="hoverJointId === joint.id" size="small" type="danger" text :icon="Delete"
            @click.stop="handleDeleteJoint(joint.id)" />
        </div>
      </div>
    </div>

    <!-- 选中 Joint 的详细编辑 -->
    <div v-if="selectedJoint" class="joint-detail">
      <div class="detail-section">
        <div class="detail-label">Parent: {{ getParentName(selectedJoint) }}</div>
        <div class="detail-label">Child: {{ getChildName(selectedJoint) }}</div>
      </div>

      <div class="detail-section">
        <div class="detail-title">
          Origin
          <el-button v-if="!urdfStore.edgePickEditJointId" size="small" type="warning" text
            @click="handleStartEdgePick">
            🎯 拾取边
          </el-button>
          <el-button v-else size="default" type="success" @click="handleStopEdgePick">
            完成拾取
          </el-button>
          <el-button v-if="urdfStore.edgePickEditJointId === selectedJoint?.id" size="small" type="info" text
            @click="handleFlipNormal">
            🔄 反转
          </el-button>
        </div>
        <div class="detail-row">
          <span class="row-label">xyz:</span>
          <el-input-number v-model="selectedJoint.origin.xyz[0]" size="small" :step="0.001" :precision="4"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.origin.xyz[1]" size="small" :step="0.001" :precision="4"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.origin.xyz[2]" size="small" :step="0.001" :precision="4"
            controls-position="right" style="width: 90px" />
        </div>
        <div class="detail-row">
          <span class="row-label">rpy:</span>
          <el-input-number v-model="selectedJoint.origin.rpy[0]" size="small" :step="0.01" :precision="4"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.origin.rpy[1]" size="small" :step="0.01" :precision="4"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.origin.rpy[2]" size="small" :step="0.01" :precision="4"
            controls-position="right" style="width: 90px" />
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-title">Axis</div>
        <div class="detail-row">
          <span class="row-label">xyz:</span>
          <el-input-number v-model="selectedJoint.axis[0]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.axis[1]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
            controls-position="right" style="width: 90px" />
          <el-input-number v-model="selectedJoint.axis[2]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
            controls-position="right" style="width: 90px" />
        </div>
      </div>

      <div class="detail-section" v-if="selectedJoint.type !== 'fixed'">
        <div class="detail-title">Limits</div>
        <div class="detail-row">
          <span class="row-label">lower:</span>
          <el-input-number v-model="selectedJoint.limits.lower" size="small" :step="0.1" :precision="4"
            controls-position="right" style="width: 120px" />
        </div>
        <div class="detail-row">
          <span class="row-label">upper:</span>
          <el-input-number v-model="selectedJoint.limits.upper" size="small" :step="0.1" :precision="4"
            controls-position="right" style="width: 120px" />
        </div>
        <div class="detail-row">
          <span class="row-label">effort:</span>
          <el-input-number v-model="selectedJoint.limits.effort" size="small" :step="1" :precision="1"
            controls-position="right" style="width: 120px" />
        </div>
        <div class="detail-row">
          <span class="row-label">velocity:</span>
          <el-input-number v-model="selectedJoint.limits.velocity" size="small" :step="0.1" :precision="2"
            controls-position="right" style="width: 120px" />
        </div>
      </div>
    </div>

    <div v-if="urdfStore.robot.joints.length === 0" class="empty-hint">
      需要至少 2 个 Link 才能创建 Joint
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useURDFStore } from '../../stores/useURDFStore'
import type { URDFJoint, JointType } from '../../types'

const urdfStore = useURDFStore()
const hoverJointId = ref<string | null>(null)

/** 导航守卫：Solid 绑定进行中时，阻止切换关节 */
function guardActiveMode(): boolean {
  if (urdfStore.bindingMode.active) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再操作')
    return true
  }
  return false
}

const emit = defineEmits<{
  (e: 'selectJoint', jointId: string): void
  (e: 'startEdgePick'): void
  (e: 'stopEdgePick'): void
  (e: 'flipNormal'): void
}>()

const selectedJoint = computed(() => {
  if (!urdfStore.selectedJointId) return null
  return urdfStore.jointMap.get(urdfStore.selectedJointId) || null
})

function handleAddJoint(): void {
  if (guardActiveMode()) return
  urdfStore.jointWizardVisible = true
  urdfStore.jointWizardStep = 'select-links'
}

function handleSelectJoint(jointId: string): void {
  if (guardActiveMode()) return
  urdfStore.selectedJointId = jointId
  emit('selectJoint', jointId)
}

function handleStartEdgePick(): void {
  if (!urdfStore.selectedJointId) return
  urdfStore.edgePickEditJointId = urdfStore.selectedJointId
  emit('startEdgePick')
}

function handleStopEdgePick(): void {
  urdfStore.edgePickEditJointId = null
  emit('stopEdgePick')
}

function handleFlipNormal(): void {
  emit('flipNormal')
}

function handleDeleteJoint(jointId: string): void {
  urdfStore.removeJoint(jointId)
}

function handleTypeChange(jointId: string, type: JointType): void {
  urdfStore.updateJoint(jointId, { type })
}

function getJointIcon(type: string): string {
  const icons: Record<string, string> = {
    revolute: '🔄',
    prismatic: '↔️',
    fixed: '🔒',
    continuous: '🔁'
  }
  return icons[type] || '⚙️'
}

function getParentName(joint: URDFJoint): string {
  return urdfStore.linkMap.get(joint.parentLinkId)?.name || joint.parentLinkId
}

function getChildName(joint: URDFJoint): string {
  return urdfStore.linkMap.get(joint.childLinkId)?.name || joint.childLinkId
}
</script>

<style lang="scss" scoped>
.joints-module {
  .module-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .module-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }
}

.joint-list {
  max-height: 180px;
  overflow-y: auto;
}

.joint-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f5f7fa;
  }

  &.active {
    background: rgba(64, 158, 255, 0.1);
    border-left: 2px solid #409eff;
  }
}

.joint-main {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.joint-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.joint-name {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.joint-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.joint-detail {
  margin-top: 8px;
  padding: 8px;
  background: #fafafa;
  border-radius: 4px;
  border: 1px solid #ebeef5;
}

.detail-section {
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
}

.detail-label {
  font-size: 11px;
  color: #606266;
  margin-bottom: 2px;
}

.detail-title {
  font-size: 11px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;

  .row-label {
    font-size: 11px;
    color: #909399;
    width: 42px;
    flex-shrink: 0;
  }
}

.empty-hint {
  font-size: 11px;
  color: #909399;
  padding: 4px 0;
}
</style>
