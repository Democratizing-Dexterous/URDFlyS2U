<template>
  <div class="view-controls">
    <div class="control-row">
      <span class="control-label">显示关节坐标系</span>
      <el-switch v-model="urdfStore.showFrames" />
    </div>
    <div class="control-row axis-row">
      <span class="control-label">轴长库尺</span>
      <el-slider v-model="urdfStore.axisHelperScale" :min="0.1" :max="5" :step="0.1" :show-tooltip="true"
        :format-tooltip="(v: number) => v.toFixed(1) + 'x'" style="flex: 1; min-width: 60px" />
      <span class="axis-value">{{ urdfStore.axisHelperScale.toFixed(1) }}x</span>
    </div>

    <!-- 整机惯量计算入口 -->
    <div class="control-row">
      <el-button type="primary" plain style="width: 100%" @click="openInertiaDialog">
        整机惯量计算
      </el-button>
    </div>
  </div>

  <!-- 整机惯量计算对话框 -->
  <el-dialog v-model="inertiaDialogVisible" title="整机惯量计算" width="600px" :close-on-click-modal="false" append-to-body>
    <div class="inertia-dialog-body">
      <el-alert title="按各连杆体积比自动分配质量，并计算惯性张量" type="info" :closable="false" show-icon style="margin-bottom: 12px" />

      <!-- 总质量输入 -->
      <div class="param-row">
        <span class="param-label">整机总质量</span>
        <el-input-number v-model="totalMass" :min="0.001" :max="100000" :precision="3" :step="1"
          controls-position="right" style="width: 160px" />
        <span class="param-unit">kg</span>
      </div>

      <!-- 计算进度 -->
      <div v-if="computing" class="progress-row">
        <el-icon class="is-loading">
          <Loading />
        </el-icon>
        <span>{{ progressText }}</span>
      </div>

      <!-- 结果表格 -->
      <div v-if="computedResults.length > 0" class="result-section">
        <el-divider style="margin: 10px 0" />
        <div class="result-header">
          <span class="result-title">计算结果（共 {{ computedResults.length }} 个连杆）</span>
          <el-button type="success" plain @click="applyResults">应用到所有连杆</el-button>
        </div>
        <el-table :data="computedResults" :row-key="(row: ResultRow) => row.linkId" style="margin-top: 4px">
          <el-table-column prop="name" label="连杆" min-width="80" show-overflow-tooltip align="center" />
          <el-table-column label="质量 (kg)" width="148" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.mass" :min="0.0001" :max="100000" :precision="4" :step="0.1"
                controls-position="right" style="width: 136px" @change="recalcInertia(row)" size="" />
            </template>
          </el-table-column>
          <el-table-column label="质心 (m)" min-width="150" align="center">
            <template #default="{ row }">
              {{ formatCom(row.com) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <template #footer>
      <el-button @click="inertiaDialogVisible = false">关闭</el-button>
      <el-button type="primary" :loading="computing" :disabled="totalMass <= 0" @click="runCompute">
        开始计算
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import { useStepViewerStore } from '../../stores/useStepViewerStore'
import { computeRefInertias } from '../../core/useInertiaWorker'
import type { SerializedSolidData, InertialParams } from '../../types'

const urdfStore = useURDFStore()
const stepStore = useStepViewerStore()

function formatCom(com: [number, number, number]): string {
  return com.map(v => v.toFixed(3)).join(', ')
}

// ——— 对话框状态 ———
const inertiaDialogVisible = ref(false)
const totalMass = ref(10)
const computing = ref(false)
const progressText = ref('')

interface ResultRow {
  linkId: string
  name: string
  /** 当前（可编辑）质量 */
  mass: number
  com: [number, number, number]
  /** 当前惯性张量（随 mass 自动缩放） */
  inertia: InertialParams['inertia']
  /** density=1 时的参考质量（正比于体积），用于按比例反推惯性 */
  refMass: number
  /** density=1 时的参考惯性张量 */
  refInertia: InertialParams['inertia']
}
const computedResults = ref<ResultRow[]>([])

function openInertiaDialog(): void {
  computedResults.value = []
  inertiaDialogVisible.value = true
}

async function runCompute(): Promise<void> {
  if (computing.value) return

  // ── 在清空前保存当前已编辑的质量和 isRerun 状态 ──────────────────────
  // 必须在 computedResults.value = [] 之前保存，否则数据丢失
  const existingMassMap = new Map(computedResults.value.map(r => [r.linkId, r.mass]))
  const isRerun = computedResults.value.length > 0

  computing.value = true
  progressText.value = '正在收集几何数据…'
  computedResults.value = []

  try {
    // 收集各 Link 的几何数据
    const linkInputs = urdfStore.robot.links
      .filter(l => l.solidIds.length > 0)
      .map(l => ({
        linkId: l.id,
        solidDataList: l.solidIds
          .map(sid => stepStore.solidMap.get(sid)?.serializedData)
          .filter((d): d is SerializedSolidData => !!d),
      }))
      .filter(l => l.solidDataList.length > 0)

    if (linkInputs.length === 0) {
      ElMessage.warning('没有绑定几何体的连杆，无法计算')
      return
    }

    progressText.value = `正在计算 ${linkInputs.length} 个连杆的参考惯量…`

    // 获取 density=1 时的参考惯性（正比于体积，不按 totalMass 缩放）
    const refMap = await computeRefInertias(linkInputs)

    if (refMap.size === 0) {
      ElMessage.warning('计算结果为空，请检查各连杆是否绑定了有效的几何体')
      return
    }

    // 参考总质量（用于为无历史记录的新连杆按体积比分配质量）
    const totalRefMass = [...refMap.values()].reduce((s, r) => s + r.mass, 0)

    const newResults: ResultRow[] = []
    for (const [linkId, refParams] of refMap) {
      let targetMass: number
      if (isRerun && existingMassMap.has(linkId)) {
        // ── 重新计算：保留用户手动编辑的质量，其他连杆不受影响 ──
        targetMass = existingMassMap.get(linkId)!
      } else {
        // ── 首次计算或新增连杆：按体积比分配 totalMass ──
        targetMass = (refParams.mass / totalRefMass) * totalMass.value
      }

      const k = targetMass / refParams.mass
      const inertia = refParams.inertia.map(v => v * k) as InertialParams['inertia']

      newResults.push({
        linkId,
        name: urdfStore.linkMap.get(linkId)?.name ?? linkId,
        mass: targetMass,
        com: refParams.com,
        inertia,
        // 以当前目标质量/惯性为新基准，供后续 recalcInertia 使用
        refMass: targetMass,
        refInertia: inertia,
      })
    }

    computedResults.value = newResults
    // 同步总质量为各行之和（涵盖新增连杆后的实际总质量）
    totalMass.value = parseFloat(newResults.reduce((s, r) => s + r.mass, 0).toFixed(6))

    const hint = isRerun ? '（已保留手动编辑的质量）' : ''
    ElMessage.success(`计算完成，共 ${newResults.length} 个连杆${hint}`)
  } catch (e) {
    ElMessage.error(`计算失败: ${(e as Error).message}`)
  } finally {
    computing.value = false
    progressText.value = ''
  }
}

/**
 * 用户手动修改某行质量后，按原始参考值的比例重算该行惯性张量。
 * 惯性张量与质量成线性关系（同密度假设下体积固定）：
 *   inertia_new = refInertia × (mass_new / refMass)
 * 质心（几何中心）与质量无关，无需修改。
 * 同步更新整机总质量为各行之和，保持数据一致。
 */
function recalcInertia(row: ResultRow): void {
  if (row.refMass <= 0 || !Number.isFinite(row.mass) || row.mass <= 0) return
  const k = row.mass / row.refMass
  row.inertia = row.refInertia.map(v => v * k) as InertialParams['inertia']
  // 同步整机总质量 = 各行质量之和，让上方输入框实时反映当前状态
  totalMass.value = parseFloat(
    computedResults.value.reduce((s, r) => s + r.mass, 0).toFixed(6)
  )
}

function applyResults(): void {
  let count = 0
  for (const row of computedResults.value) {
    urdfStore.setLinkInertial(row.linkId, {
      mass: row.mass,
      com: row.com,
      inertia: row.inertia,
    })
    count++
  }
  ElMessage.success(`已将惯性参数应用到 ${count} 个连杆`)
  inertiaDialogVisible.value = false
}
</script>

<style lang="scss" scoped>
.view-controls {
  padding: 4px 8px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  color: #303133;
}

.control-label {
  flex-shrink: 0;
  font-size: 14px;
}

.axis-row {
  padding-top: 2px;
}

.axis-value {
  font-size: 10px;
  color: #909399;
  flex-shrink: 0;
  width: 26px;
  text-align: right;
}

.inertia-dialog-body {
  padding: 0 4px;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.param-label {
  flex-shrink: 0;
  font-size: 16px;
  color: #303133;
  width: 80px;
}

.param-unit {
  font-size: 12px;
  color: #606266;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #409eff;
  margin-bottom: 8px;
}

.result-section {
  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .result-title {
    font-size: 16px;
    color: #606266;
  }

  .edit-hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: #909399;
  }
}
</style>
