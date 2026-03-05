<template>
  <Teleport to="body">
    <div v-show="urdfStore.jointWizardVisible" class="joint-wizard-panel" :style="panelStyle">
      <!-- 标题栏（可拖拽） -->
      <div class="panel-header" @mousedown="startDrag">
        <span class="panel-title">⚙️ 创建关节</span>
        <div class="panel-actions">
          <el-tag v-if="pickedEdgeInfo" type="success" size="small">{{ pickedEdgeInfo }}</el-tag>
          <el-button size="small" text @click="handleClose" style="color:#ccc">✕</el-button>
        </div>
      </div>

      <div class="panel-body">
        <!-- Links 选择 -->
        <div class="field-row">
          <span class="field-label">Parent:</span>
          <el-select v-model="parentLinkId" placeholder="Parent Link" size="small" style="flex:1">
            <el-option v-for="l in urdfStore.robot.links" :key="l.id" :label="l.name" :value="l.id" />
          </el-select>
        </div>
        <div class="field-row">
          <span class="field-label">Child:</span>
          <el-select v-model="childLinkId" placeholder="Child Link" size="small" style="flex:1">
            <el-option v-for="l in availableChildLinks" :key="l.id" :label="l.name" :value="l.id"
              :disabled="l.id === parentLinkId" />
          </el-select>
        </div>

        <!-- 提示：打开面板即可直接拾取 -->
        <div class="pick-hint">
          <el-tag size="small" type="warning">🎯 直接点击 3D 圆弧边/直线拾取轴线</el-tag>
          <el-button v-if="hasSnap" size="small" type="info" text @click="handleFlipNormal">🔄 反转轴向</el-button>
        </div>

        <!-- Origin XYZ -->
        <div class="field-row">
          <span class="field-label">Origin:</span>
          <div class="vec3-inputs">
            <el-input-number v-model="originXYZ[0]" size="small" :step="0.001" :precision="6"
              controls-position="right" />
            <el-input-number v-model="originXYZ[1]" size="small" :step="0.001" :precision="6"
              controls-position="right" />
            <el-input-number v-model="originXYZ[2]" size="small" :step="0.001" :precision="6"
              controls-position="right" />
          </div>
        </div>

        <!-- Origin RPY -->
        <div class="field-row">
          <span class="field-label">RPY:</span>
          <div class="vec3-inputs">
            <el-input-number v-model="originRPY[0]" size="small" :step="0.01" :precision="6"
              controls-position="right" />
            <el-input-number v-model="originRPY[1]" size="small" :step="0.01" :precision="6"
              controls-position="right" />
            <el-input-number v-model="originRPY[2]" size="small" :step="0.01" :precision="6"
              controls-position="right" />
          </div>
        </div>

        <!-- Axis -->
        <div class="field-row">
          <span class="field-label">Axis:</span>
          <div class="vec3-inputs">
            <el-input-number v-model="axis[0]" size="small" :step="0.01" :precision="6" :min="-1" :max="1"
              controls-position="right" />
            <el-input-number v-model="axis[1]" size="small" :step="0.01" :precision="6" :min="-1" :max="1"
              controls-position="right" />
            <el-input-number v-model="axis[2]" size="small" :step="0.01" :precision="6" :min="-1" :max="1"
              controls-position="right" />
          </div>
        </div>

        <!-- Type + Name -->
        <div class="field-row">
          <span class="field-label">Type:</span>
          <el-select v-model="jointType" size="small" style="flex:1">
            <el-option label="Revolute" value="revolute" />
            <el-option label="Prismatic" value="prismatic" />
            <el-option label="Fixed" value="fixed" />
            <el-option label="Continuous" value="continuous" />
          </el-select>
        </div>
        <div class="field-row">
          <span class="field-label">Name:</span>
          <el-input v-model="jointName" placeholder="自动生成" size="small" style="flex:1" />
        </div>

        <!-- Limits -->
        <template v-if="jointType !== 'fixed'">
          <div class="limits-header">限位</div>
          <div class="field-row">
            <span class="field-label">Lower:</span>
            <el-input-number v-model="limits.lower" size="small" :step="0.1" :precision="4" controls-position="right" />
            <el-button size="small" text @click="limits.lower = -Math.PI">-π</el-button>
          </div>
          <div class="field-row">
            <span class="field-label">Upper:</span>
            <el-input-number v-model="limits.upper" size="small" :step="0.1" :precision="4" controls-position="right" />
            <el-button size="small" text @click="limits.upper = Math.PI">π</el-button>
          </div>
          <div class="field-row">
            <span class="field-label">Effort:</span>
            <el-input-number v-model="limits.effort" size="small" :step="1" :precision="1" controls-position="right" />
          </div>
          <div class="field-row">
            <span class="field-label">Velocity:</span>
            <el-input-number v-model="limits.velocity" size="small" :step="0.1" :precision="2"
              controls-position="right" />
          </div>
        </template>
      </div>

      <!-- 底部按钮 -->
      <div class="panel-footer">
        <el-button size="small" @click="handleClose">取消</el-button>
        <el-button size="default" type="success" :disabled="!canCreate" @click="handleCreate"> 创建关节</el-button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount, type CSSProperties } from 'vue'
import * as THREE from 'three'
import { ElMessage } from 'element-plus'
import { useURDFStore } from '../../stores/useURDFStore'
import { computeRelativeTransform } from '../../core/useKinematicsWorker'
import type { JointType, GeometryFeature } from '../../types'

const urdfStore = useURDFStore()

const emit = defineEmits<{
  (e: 'created', jointId: string): void
  (e: 'startEdgePick'): void
  (e: 'stopEdgePick'): void
  (e: 'flipNormal'): void
}>()

// 面板位置
const position = reactive({ x: window.innerWidth - 420, y: 80 })

const panelStyle = computed<CSSProperties>(() => ({
  left: `${position.x}px`,
  top: `${position.y}px`
}))

// 表单数据
const parentLinkId = ref('')
const childLinkId = ref('')
const originXYZ = reactive<[number, number, number]>([0, 0, 0])
const originRPY = reactive<[number, number, number]>([0, 0, 0])
const axis = reactive<[number, number, number]>([0, 0, 1])
const jointName = ref('')
const jointType = ref<JointType>('revolute')
const limits = reactive({ lower: -3.14159, upper: 3.14159, effort: 100, velocity: 1 })
const pickedEdgeInfo = ref('')

/** 缓存当前 snap 世界坐标（用于反转轴向时重新计算） */
let cachedSnapPosition: [number, number, number] | null = null
let cachedSnapNormal: [number, number, number] | null = null

const availableChildLinks = computed(() => {
  const usedChildIds = new Set(urdfStore.robot.joints.map(j => j.childLinkId))
  return urdfStore.robot.links.filter(l => !usedChildIds.has(l.id) && !urdfStore.isBaseLink(l.id))
})

const canCreate = computed(() => {
  return parentLinkId.value && childLinkId.value && parentLinkId.value !== childLinkId.value
})

/** 是否已拾取过边（缓存了 snap 数据），用于显示反转按钮 */
const hasSnap = computed(() => cachedSnapNormal !== null)

function handleCreate(): void {
  const result = urdfStore.addJoint({
    name: jointName.value || undefined,
    type: jointType.value,
    parentLinkId: parentLinkId.value,
    childLinkId: childLinkId.value,
    origin: {
      xyz: [...originXYZ] as [number, number, number],
      rpy: [...originRPY] as [number, number, number]
    },
    axis: [...axis] as [number, number, number],
    limits: { ...limits }
  })
  if (!result.ok) {
    ElMessage.warning(result.reason)
    return
  }
  emit('created', result.joint.id)
  handleClose()
}

function handleClose(): void {
  emit('stopEdgePick')
  urdfStore.jointWizardVisible = false
  urdfStore.jointWizardStep = 'select-links'
  resetForm()
}

function resetForm(): void {
  parentLinkId.value = ''
  childLinkId.value = ''
  originXYZ[0] = originXYZ[1] = originXYZ[2] = 0
  originRPY[0] = originRPY[1] = originRPY[2] = 0
  axis[0] = 0; axis[1] = 0; axis[2] = 1
  jointName.value = ''
  jointType.value = 'revolute'
  limits.lower = -3.14159; limits.upper = 3.14159; limits.effort = 100; limits.velocity = 1
  pickedEdgeInfo.value = ''
  cachedSnapPosition = null
  cachedSnapNormal = null
}

/** 由外部调用：3D 场景拾取到边时触发，通过 Worker 计算相对坐标 */
async function applyPickedEdge(feature: GeometryFeature): Promise<void> {
  // 提取 snap 数据
  let snapPos: [number, number, number]
  let snapNorm: [number, number, number]

  if (feature.edgeCurveType === 'line') {
    if (!feature.startPoint || !feature.endPoint) return
    const dir = feature.endPoint.clone().sub(feature.startPoint).normalize()
    snapPos = [feature.startPoint.x, feature.startPoint.y, feature.startPoint.z]
    snapNorm = [dir.x, dir.y, dir.z]
    pickedEdgeInfo.value = '直线'
  } else {
    if (!feature.center || (!feature.axis && !feature.normal)) return
    const norm = (feature.axis || feature.normal)!
    snapPos = [feature.center.x, feature.center.y, feature.center.z]
    snapNorm = [norm.x, norm.y, norm.z]
    pickedEdgeInfo.value = feature.edgeCurveType || feature.type
  }

  // 缓存 snap 数据（供反转使用）
  cachedSnapPosition = snapPos
  cachedSnapNormal = snapNorm

  await applySnapToForm(snapPos, snapNorm)
}

/** 反转轴向并重新计算 RPY */
async function handleFlipNormal(): Promise<void> {
  if (!cachedSnapNormal || !cachedSnapPosition) return

  // 反转法线
  cachedSnapNormal = [
    -cachedSnapNormal[0],
    -cachedSnapNormal[1],
    -cachedSnapNormal[2]
  ]

  // 通知主线程反转 Gizmo
  emit('flipNormal')

  // 重新计算
  await applySnapToForm(cachedSnapPosition, cachedSnapNormal)
}

/** 将 snap 数据通过 Worker 计算并填入表单 */
async function applySnapToForm(
  snapPos: [number, number, number],
  snapNorm: [number, number, number]
): Promise<void> {
  // 获取父级世界矩阵
  const parentWorld = parentLinkId.value
    ? urdfStore.linkWorldTransforms.get(parentLinkId.value)
    : null
  const parentElements = parentWorld ? parentWorld.elements : new THREE.Matrix4().elements

  // Worker 异步计算
  const result = await computeRelativeTransform(parentElements, snapPos, snapNorm)

  // 填入表单
  originXYZ[0] = result.xyz[0]
  originXYZ[1] = result.xyz[1]
  originXYZ[2] = result.xyz[2]
  originRPY[0] = result.rpy[0]
  originRPY[1] = result.rpy[1]
  originRPY[2] = result.rpy[2]
  // RPY 已将关节局部 Z 轴对齐到 snapNormal，因此 axis 为局部 Z
  axis[0] = 0
  axis[1] = 0
  axis[2] = 1
}

defineExpose({ applyPickedEdge })

// ★ 打开面板时自动进入边拾取模式，关闭时自动退出
watch(() => urdfStore.jointWizardVisible, (vis) => {
  if (vis) {
    resetForm()
    // 重置位置到右上角
    position.x = window.innerWidth - 420
    position.y = 80
    emit('startEdgePick')
  } else {
    emit('stopEdgePick')
  }
})

// ========== 拖拽逻辑 ==========
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragStartPosX = 0
let dragStartPosY = 0

function startDrag(e: MouseEvent): void {
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPosX = position.x
  dragStartPosY = position.y
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging) return
  position.x = dragStartPosX + (e.clientX - dragStartX)
  position.y = dragStartPosY + (e.clientY - dragStartY)
}

function onDragEnd(): void {
  isDragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<style lang="scss" scoped>
.joint-wizard-panel {
  position: fixed;
  z-index: 1500;
  width: 390px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #2d2d2d;
  cursor: move;
  user-select: none;
  border-radius: 8px 8px 0 0;
}

.panel-title {
  font-size: 13px;
  color: #e0e0e0;
  font-weight: 600;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-body {
  padding: 10px 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.pick-hint {
  margin: 4px 0 8px;
}

.field-row {
  display: flex;
  align-items: center;
  margin-bottom: 7px;
  gap: 6px;

  .field-label {
    font-size: 12px;
    color: #303133;
    white-space: nowrap;
    width: 52px;
    flex-shrink: 0;
  }
}

.vec3-inputs {
  display: flex;
  gap: 3px;
  flex: 1;

  .el-input-number {
    width: 95px;
  }
}

.limits-header {
  font-size: 11px;
  color: #909399;
  margin: 4px 0 5px;
  padding-top: 5px;
  border-top: 1px solid #ebeef5;
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #ebeef5;
}
</style>
