<template>
  <div class="link-properties" v-if="link">
    <div v-if="urdfStore.isBaseLink(link.id)" class="base-origin-section">
      <div class="base-origin-header">
        <span class="base-origin-title">🌐 基坐标系原点</span>
        <el-tag :type="urdfStore.baseLinkOrigin ? 'success' : 'warning'" effect="light">
          {{ urdfStore.baseLinkOrigin ? "已设置" : "未设置" }}
        </el-tag>
      </div>

      <el-alert
        v-if="link.solidIds.length > 0 && !urdfStore.baseLinkOrigin"
        title="已绑定 Solid，请设置坐标基点以定义运动树计算起点"
        type="warning"
        :closable="false"
        show-icon
        class="base-origin-alert"
      />

      <div class="origin-rows">
        <div class="origin-row" v-for="(ax, idx) in axisConfig" :key="ax.key">
          <span class="origin-axis-lbl" :style="{ color: ax.color }">{{ ax.key }}</span>
          <el-input-number
            :model-value="editableOrigin[idx]"
            @update:model-value="(v: number | undefined) => onAxisInput(idx, v ?? 0)"
            :precision="4"
            :step="0.001"
            controls-position="right"
            style="flex: 1; min-width: 0"
          />
        </div>
      </div>

      <div class="origin-actions">
        <div class="origin-btn-row">
          <el-button
            v-hint="'按 Z-up 约定取已绑定 Solid 包围盒的底面中心（最小 Z）'"
            type="primary"
            plain
            :disabled="link.solidIds.length === 0"
            @click="autoCalcOrigin"
          >
            自动计算
          </el-button>
          <el-button v-if="urdfStore.baseLinkOrigin" text type="danger" @click="clearBaseOrigin">
            清除
          </el-button>
        </div>
      </div>
    </div>

    <el-collapse v-model="openPanels">
      <el-collapse-item name="solids">
        <template #title>
          <span class="section-title">绑定 Solids（{{ link.solidIds.length }}）</span>
        </template>
        <div class="prop-form">
          <div
            v-for="solidId in link.solidIds"
            :key="solidId"
            class="solid-item"
            :class="{ 'is-focused': stepStore.focusedSolidId === solidId }"
          >
            <el-checkbox
              v-if="link.solidIds.length > 1"
              :model-value="mergeSelection.includes(solidId)"
              @change="toggleMergeSelection(solidId)"
            />
            <el-icon>
              <Files />
            </el-icon>
            <span
              class="solid-name"
              :title="`${getSolidName(solidId)}（点击在 3D 中单独高亮）`"
              @click="toggleFocus(solidId)"
              >{{ getSolidName(solidId) }}</span
            >
            <span v-if="getSolidMass(solidId) !== null" class="solid-mass">
              {{ getSolidMass(solidId)!.toFixed(3) }} kg
            </span>
            <el-tooltip content="重命名 Solid" placement="top" :show-after="500">
              <el-button
                text
                :icon="EditPen"
                @click="handleRenameSolid(solidId)"
                class="unbind-btn"
              />
            </el-tooltip>
            <el-tooltip content="按连通面片拆解为多个 Solid" placement="top" :show-after="500">
              <el-button
                text
                type="success"
                :icon="Scissor"
                :loading="splitting"
                @click="handleSplit([solidId])"
                class="unbind-btn"
              />
            </el-tooltip>
            <el-button
              text
              type="danger"
              :icon="Delete"
              @click="handleUnbind(solidId)"
              class="unbind-btn"
            />
          </div>

          <div class="bind-actions">
            <el-button
              v-if="!urdfStore.bindingMode.active"
              type="primary"
              plain
              :icon="Paperclip"
              @click="urdfStore.startBindingMode(link.id)"
            >
              绑定 Solid
            </el-button>
            <template v-else-if="urdfStore.bindingMode.targetLinkId === link.id">
              <el-button size="default" type="success" @click="urdfStore.stopBindingMode()">
                完成绑定</el-button
              >
            </template>
            <el-button
              v-if="link.solidIds.length > 0 && geometryEdit"
              v-hint="'把该连杆下所有 Solid 按连通面片拆细，用于精确计算质心与惯量'"
              type="success"
              plain
              :icon="Scissor"
              :loading="splitting"
              @click="handleSplit(link.solidIds.slice())"
            >
              拆解全部
            </el-button>
            <el-button
              v-if="mergeSelection.length >= 2 && geometryEdit"
              v-hint="'把勾选的 Solid 合并成一个，质量取各自之和，连杆惯量随之重算'"
              type="warning"
              plain
              :icon="Connection"
              :loading="merging"
              @click="handleMerge"
            >
              合并所选（{{ mergeSelection.length }}）
            </el-button>
          </div>

          <div v-if="link.solidIds.length === 0" class="empty-hint">尚未绑定任何 Solid</div>
        </div>
      </el-collapse-item>

      <el-collapse-item name="physics">
        <template #title>
          <span class="section-title">物理属性</span>
        </template>
        <div class="prop-form">
          <template v-if="link.inertial">
            <div class="prop-row">
              <span class="prop-label">质量</span>
              <span class="prop-value">{{ link.inertial.mass.toFixed(4) }} kg</span>
            </div>
            <div class="prop-row">
              <span class="prop-label">质心</span>
              <span class="prop-value">
                {{ localInertial!.com.map((v) => v.toFixed(2)).join(", ") }} mm
              </span>
            </div>
            <div class="prop-row">
              <span class="prop-label" title="惯量主轴姿态，顺序 w, x, y, z">quat</span>
              <span class="prop-value">
                {{ formatQuat(localInertial!.inertia) }}
              </span>
            </div>
            <div class="inertia-grid">
              <span class="inertia-title">惯性张量（kg·m²，连杆系）</span>
              <div class="inertia-row">
                <span class="inertia-cell"
                  >Ixx: {{ localInertial!.inertia[0].toExponential(3) }}</span
                >
                <span class="inertia-cell"
                  >Ixy: {{ localInertial!.inertia[1].toExponential(3) }}</span
                >
                <span class="inertia-cell"
                  >Ixz: {{ localInertial!.inertia[2].toExponential(3) }}</span
                >
              </div>
              <div class="inertia-row">
                <span class="inertia-cell"
                  >Iyy: {{ localInertial!.inertia[3].toExponential(3) }}</span
                >
                <span class="inertia-cell"
                  >Iyz: {{ localInertial!.inertia[4].toExponential(3) }}</span
                >
                <span class="inertia-cell"
                  >Izz: {{ localInertial!.inertia[5].toExponential(3) }}</span
                >
              </div>
            </div>
            <p class="frame-hint">质心 / quat / 张量均为该连杆自身坐标系下的值，与导出结果一致</p>
          </template>
          <div v-else class="empty-hint">请使用左侧「整机惯量计算」功能统一计算</div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>

  <div v-else class="empty-hint">未选中任何连杆</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { isDialogDismissed, promptDialog } from "../../utils/dialog";
import { vHint } from "../composables/useHintBar";
import { ElMessage } from "element-plus";
import Files from "~icons/ep/files";
import Delete from "~icons/ep/delete";
import Paperclip from "~icons/ep/paperclip";
import Scissor from "~icons/ep/scissor";
import Connection from "~icons/ep/connection";
import EditPen from "~icons/ep/edit-pen";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";
import { useGeometryEditApi } from "../composables/useGeometryEdit";
import { principalAxisQuat } from "../../core/useInertiaWorker";
import { buildLinkRestInverses, toLinkLocalInertial } from "../../core/InertiaFrame";
import type { InertialParams } from "../../types";

function formatQuat(inertia: InertialParams["inertia"]): string {
  const [x, y, z, w] = principalAxisQuat(inertia);
  return [w, x, y, z].map((v) => v.toFixed(4)).join(", ");
}

const urdfStore = useURDFStore();
const stepStore = useStepViewerStore();
const geometryEdit = useGeometryEditApi();
const splitting = ref(false);
const merging = ref(false);
const mergeSelection = ref<string[]>([]);

function toggleMergeSelection(solidId: string): void {
  const i = mergeSelection.value.indexOf(solidId);
  if (i >= 0) mergeSelection.value.splice(i, 1);
  else mergeSelection.value.push(solidId);
}

async function handleMerge(): Promise<void> {
  if (!geometryEdit || merging.value) return;
  const ids = mergeSelection.value.slice();
  if (ids.length < 2) return;

  merging.value = true;
  try {
    const result = await geometryEdit.mergeSolids(ids);
    mergeSelection.value = [];
    const mass = link.value?.solidMasses?.[result.solidId];
    const massHint = typeof mass === "number" ? `，合并后质量 ${mass.toFixed(4)} kg` : "";
    ElMessage.success(`已把 ${result.merged} 个 Solid 合并为「${result.name}」${massHint}`);
  } catch (error) {
    ElMessage.error(`合并失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    merging.value = false;
  }
}

async function handleSplit(solidIds: string[]): Promise<void> {
  if (!geometryEdit || solidIds.length === 0 || splitting.value) return;
  splitting.value = true;
  try {
    const results = await geometryEdit.splitSolids(solidIds);
    const total = results.reduce((sum, r) => sum + Math.max(r.parts, 1), 0);
    if (total <= solidIds.length) {
      ElMessage.info("这些实体是单一连通体，无需拆解");
      return;
    }
    mergeSelection.value = [];
    const inertial = link.value?.inertial;
    const hint = inertial ? `，质量 ${inertial.mass.toFixed(4)} kg 保持不变，质心与惯量已重算` : "";
    ElMessage.success(`已拆解为 ${total} 个细 Solid${hint}`);
  } catch (error) {
    ElMessage.error(`拆解失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    splitting.value = false;
  }
}

const openPanels = ref<string[]>(["solids", "physics"]);

const link = computed(() => {
  if (!urdfStore.selectedLinkId) return null;
  return urdfStore.linkMap.get(urdfStore.selectedLinkId) ?? null;
});

const localInertial = computed<InertialParams | null>(() => {
  const current = link.value;
  if (!current?.inertial) return null;
  const restInverse = buildLinkRestInverses(urdfStore.robot, {
    baseLinkId: urdfStore.BASE_LINK_ID,
    baseLinkOrigin: urdfStore.baseLinkOrigin,
    baseLinkRPY: urdfStore.baseLinkRPY,
  }).get(current.id);
  return toLinkLocalInertial(current.inertial, restInverse);
});

watch(
  () => urdfStore.selectedLinkId,
  () => {
    mergeSelection.value = [];
  },
);

function handleUnbind(solidId: string): void {
  if (link.value) urdfStore.unbindSolid(link.value.id, solidId);
}

function getSolidName(solidId: string): string {
  return stepStore.solidNameMap.get(solidId) ?? solidId;
}

function toggleFocus(solidId: string): void {
  stepStore.setFocusedSolid(stepStore.focusedSolidId === solidId ? null : solidId);
}

async function handleRenameSolid(solidId: string): Promise<void> {
  try {
    const { value } = await promptDialog("输入新的 Solid 名称", "重命名 Solid", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: getSolidName(solidId),
      inputValidator: (v: string) => (v && v.trim().length > 0 ? true : "名称不能为空"),
    });
    if (geometryEdit?.renameSolid(solidId, value) ?? stepStore.renameSolid(solidId, value)) {
      ElMessage.success(`已重命名为「${value.trim()}」`);
    } else {
      ElMessage.info("名称未变化");
    }
  } catch (error) {
    if (!isDialogDismissed(error)) {
      ElMessage.error(`重命名失败：${(error as Error)?.message ?? error}`);
    }
  }
}

function getSolidMass(solidId: string): number | null {
  const m = link.value?.solidMasses?.[solidId];
  return typeof m === "number" && m > 0 ? m : null;
}

const axisConfig = [
  { key: "X", color: "#f56c6c" },
  { key: "Y", color: "#67c23a" },
  { key: "Z", color: "#409eff" },
];

const editableOrigin = ref<[number, number, number]>([0, 0, 0]);

watch(
  () => urdfStore.baseLinkOrigin,
  (v) => {
    editableOrigin.value = v ? ([...v] as [number, number, number]) : [0, 0, 0];
  },
  { immediate: true, deep: true },
);

function onAxisInput(idx: number, val: number): void {
  const o: [number, number, number] = [...editableOrigin.value] as [number, number, number];
  o[idx] = val;
  editableOrigin.value = o;
  urdfStore.baseLinkOrigin = [...o] as [number, number, number];
}

function clearBaseOrigin(): void {
  urdfStore.baseLinkOrigin = null;
  urdfStore.baseLinkRPY = null;
}

function autoCalcOrigin(): void {
  if (!link.value || link.value.solidIds.length === 0) return;
  let xMin = Infinity,
    yMin = Infinity,
    zMin = Infinity;
  let xMax = -Infinity,
    yMax = -Infinity,
    zMax = -Infinity;
  let found = false;
  for (const sid of link.value.solidIds) {
    const pos = stepStore.solidMap.get(sid)?.serializedData?.positions;
    if (!pos) continue;
    found = true;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < xMin) xMin = pos[i];
      if (pos[i] > xMax) xMax = pos[i];
      if (pos[i + 1] < yMin) yMin = pos[i + 1];
      if (pos[i + 1] > yMax) yMax = pos[i + 1];
      if (pos[i + 2] < zMin) zMin = pos[i + 2];
      if (pos[i + 2] > zMax) zMax = pos[i + 2];
    }
  }
  if (!found) {
    ElMessage.warning("未找到有效几何数据");
    return;
  }
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const cx = (xMin + xMax) / 2,
    cy = (yMin + yMax) / 2;
  const ox = cx,
    oy = cy,
    oz = zMin;
  urdfStore.baseLinkOrigin = [round(ox), round(oy), round(oz)];

  urdfStore.baseLinkRPY = [0, 0, 0];
  ElMessage.success("已自动设置基点（包围盒底面中心）");
}
</script>

<style lang="scss" scoped>
.link-properties {
  padding: 4px 0;
}

.link-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #f4f6f9;
  border-radius: 4px;
  margin-bottom: 8px;

  .link-icon {
    color: var(--accent);
    font-size: 14px;
    flex-shrink: 0;
  }

  .link-name {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    cursor: pointer;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: var(--accent);
    }
  }
}

:deep(.el-collapse) {
  border: none;

  .el-collapse-item__header {
    height: 32px;
    line-height: 32px;
    padding: 0 8px;
    font-size: 12px;
    background: #fafbfc;
    border-bottom: 1px solid #f0f2f5;
  }

  .el-collapse-item__wrap {
    border-bottom: none;
  }

  .el-collapse-item__content {
    padding: 6px 8px 8px;
  }
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}

.prop-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  .prop-label {
    font-size: 11px;
    color: #606266;
    width: 36px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .prop-value {
    font-size: 12px;
    color: #303133;
    font-family: monospace;
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .prop-unit {
    font-size: 10px;
    color: var(--text-2);
  }
}

.frame-hint {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--text-2);
}

.solid-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  background: #f9fafc;
  border: 1px solid #ebeef5;

  .el-icon {
    color: var(--text-2);
    font-size: 12px;
    flex-shrink: 0;
  }

  .solid-name {
    font-size: 11px;
    color: #606266;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    cursor: pointer;
  }

  &.is-focused {
    background: var(--el-color-primary-light-9);
    border-color: var(--accent);

    .solid-name {
      color: var(--accent);
      font-weight: 600;
    }
  }

  .unbind-btn {
    padding: 1px !important;
    height: 18px !important;
    width: 18px !important;
    min-height: unset !important;
    flex-shrink: 0;
  }

  .solid-mass {
    font-size: 10px;
    color: #67c23a;
    font-family: monospace;
    flex-shrink: 0;
  }
}

.bind-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.inertia-grid {
  .inertia-title {
    font-size: 10px;
    color: var(--text-2);
    display: block;
    margin-bottom: 4px;
  }

  .inertia-row {
    display: flex;
    gap: 4px;
    margin-bottom: 2px;
    flex-wrap: wrap;
  }

  .inertia-cell {
    font-size: 10px;
    color: #606266;
    font-family: monospace;
    background: #f4f4f5;
    padding: 1px 4px;
    border-radius: 2px;
  }
}

.empty-hint {
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
  padding: 8px 0;
}

.base-origin-section {
  margin-bottom: 8px;
  padding: 6px 8px 8px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e8f4fd 100%);
  border: 1px solid #b3d8f5;
  border-radius: 4px;

  .base-origin-alert {
    :deep(.el-alert) {
      padding: 4px 8px;
      font-size: 11px;
    }

    margin-bottom: 6px;
  }
}

.base-origin-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.base-origin-title {
  font-size: 11px;
  font-weight: 600;
  color: #1a6fb0;
  flex: 1;
}

.origin-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.origin-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.origin-axis-lbl {
  font-size: 11px;
  font-weight: 700;
  font-family: monospace;
  width: 12px;
  flex-shrink: 0;
  text-align: center;
}

.origin-actions {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.origin-btn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.orient-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
</style>
