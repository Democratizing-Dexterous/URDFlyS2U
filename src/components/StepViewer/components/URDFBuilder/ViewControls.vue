<template>
  <div class="view-controls">
    <div class="control-row">
      <span class="control-label">显示关节坐标系</span>
      <el-switch v-model="urdfStore.showFrames" />
    </div>
    <div class="control-row axis-row">
      <span class="control-label">轴长库尺</span>
      <el-slider
        v-model="urdfStore.axisHelperScale"
        :min="0.1"
        :max="5"
        :step="0.1"
        :show-tooltip="true"
        :format-tooltip="(v: number) => v.toFixed(1) + 'x'"
        style="flex: 1; min-width: 60px"
      />
      <span class="axis-value">{{ urdfStore.axisHelperScale.toFixed(1) }}x</span>
    </div>

    <div class="control-row">
      <el-button type="primary" plain style="width: 100%" @click="openInertiaPanel">
        整机惯量计算
      </el-button>
    </div>

    <el-divider class="zup-divider" />

    <div class="zup-section">
      <div class="control-row">
        <span class="control-label">整机旋转到 Z-up</span>
        <el-tag v-if="stepStore.isModelRotated" size="small" type="success" effect="light"
          >已旋转</el-tag
        >
      </div>
      <div class="control-row zup-axis-row">
        <span class="zup-hint">当前朝上轴</span>
        <el-select v-model="currentUpAxis" size="small" style="width: 92px">
          <el-option v-for="ax in UP_AXIS_OPTIONS" :key="ax" :label="ax" :value="ax" />
        </el-select>
      </div>
      <div class="control-row zup-actions">
        <el-button
          v-hint="'把整机几何、关节、惯量与基坐标系一并旋转，使所选轴指向 +Z；该操作会改写几何数据'"
          type="warning"
          plain
          size="small"
          :disabled="!stepStore.hasModel"
          @click="emit('rotateToZUp', currentUpAxis)"
        >
          🧭 旋转到 Z-up
        </el-button>
        <el-button
          v-hint="'撤销 Z-up 旋转，恢复模型导入时的原始朝向'"
          text
          size="small"
          :disabled="!stepStore.isModelRotated"
          @click="emit('resetOrientation')"
        >
          恢复原始朝向
        </el-button>
      </div>

      <el-button
        v-hint="
          '按拓扑顺序把每个关节的坐标轴都对齐到全局 Z-up 右手系（rpy 全部归零），旋转轴改用向量表达；轴心、轴向与整机运动学保持不变'
        "
        text
        type="primary"
        size="small"
        style="width: 100%; margin-top: 2px"
        :disabled="urdfStore.robot.joints.length === 0"
        @click="alignAllJointFrames"
      >
        全部关节坐标轴对齐 Z-up
      </el-button>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="fk-panel">
      <div
        v-show="inertiaPanelVisible"
        class="fk-floating-panel inertia-panel"
        ref="panelRef"
        @pointerdown="bringToFront"
      >
        <div class="fk-title-bar" ref="handleRef">
          <span class="fk-title">⚖️ 整机惯量计算</span>
          <div class="fk-title-actions">
            <el-button size="small" text circle @click="inertiaPanelVisible = false">✕</el-button>
          </div>
        </div>

        <div class="fk-body inertia-body">
          <el-alert
            title="展开连杆可为每个 Solid 单独设置质量并点击 🔓 锁定；锁定后的 Solid 质量在修改整机总质量、重新计算或按体积分配时保持不变，剩余质量只在未锁定的 Solid 之间按体积分配"
            type="info"
            :closable="false"
            show-icon
            style="margin-bottom: 12px"
          />

          <div class="param-row">
            <span class="param-label">整机总质量</span>
            <el-input-number
              v-model="totalMass"
              :min="0.001"
              :max="100000"
              :precision="3"
              :step="1"
              controls-position="right"
              style="width: 160px"
            />
            <span class="param-unit">kg</span>
            <el-tag v-if="lockedCount > 0" size="small" type="warning" effect="light">
              已锁定 {{ lockedCount }} 个 Solid，共 {{ lockedMassSum.toFixed(3) }} kg
            </el-tag>
            <el-button v-if="lockedCount > 0" text type="info" size="small" @click="clearAllLocks">
              全部解锁
            </el-button>
          </div>

          <div v-if="computing" class="progress-row">
            <el-icon class="is-loading">
              <Loading />
            </el-icon>
            <span>{{ progressText }}</span>
          </div>

          <div v-else-if="computedResults.length === 0" class="empty-hint">
            尚无惯量数据，点击下方"开始计算"生成
          </div>

          <div v-if="computedResults.length > 0" class="result-section">
            <el-divider style="margin: 10px 0" />
            <div class="result-header">
              <span class="result-title">计算结果（共 {{ computedResults.length }} 个连杆）</span>
              <div class="header-actions">
                <el-tag
                  v-if="Math.abs(massMismatch) > 1e-6"
                  size="small"
                  type="warning"
                  effect="light"
                >
                  合计 {{ computedMassSum.toFixed(3) }} kg，与整机总质量相差
                  {{ massMismatch > 0 ? "+" : "" }}{{ massMismatch.toFixed(3) }} kg
                </el-tag>
                <el-button text type="info" @click="onRedistributeClick">按体积重新分配</el-button>
              </div>
            </div>
            <el-table
              :data="computedResults"
              :row-key="(row: ResultRow) => row.linkId"
              style="margin-top: 4px"
            >
              <el-table-column type="expand">
                <template #default="{ row }">
                  <div class="solid-detail">
                    <div class="solid-detail-header">
                      <span class="solid-detail-title">
                        Solid 质量分配（{{ row.solids.length }} 个）
                      </span>
                      <el-button
                        text
                        type="info"
                        size="small"
                        @click="toggleLinkLock(row as ResultRow)"
                      >
                        {{
                          row.solids.every((s: SolidMassEntry) => s.locked)
                            ? "🔓 全部解锁"
                            : "🔒 全部锁定"
                        }}
                      </el-button>
                    </div>
                    <div v-for="s in row.solids" :key="s.solidId" class="solid-mass-row">
                      <el-button
                        v-hint="'锁定后该 Solid 的质量不会被总质量修改、重新计算或体积分配覆盖'"
                        text
                        size="small"
                        class="solid-lock-btn"
                        :type="s.locked ? 'warning' : 'info'"
                        @click="toggleSolidLock(s)"
                      >
                        {{ s.locked ? "🔒" : "🔓" }}
                      </el-button>
                      <span
                        class="solid-mass-name"
                        :class="{ 'is-locked': s.locked }"
                        :title="s.name"
                      >
                        {{ s.name }}
                      </span>
                      <span class="solid-mass-vol">{{ formatVolume(s.volume) }}</span>
                      <el-input-number
                        v-model="s.mass"
                        :min="0.0001"
                        :max="100000"
                        :precision="4"
                        :step="0.05"
                        controls-position="right"
                        style="width: 132px"
                        @change="recalcRow(row as ResultRow)"
                      />
                      <span class="solid-mass-unit">kg</span>
                      <span class="solid-mass-com">质心 {{ formatCom(row.linkId, s.com) }}</span>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                prop="name"
                label="连杆"
                min-width="90"
                show-overflow-tooltip
                align="center"
              />
              <el-table-column label="Solids" width="92" align="center">
                <template #default="{ row }">
                  {{ row.solids.length }}
                  <span v-if="row.solids.some((s: SolidMassEntry) => s.locked)" class="lock-badge">
                    🔒{{ row.solids.filter((s: SolidMassEntry) => s.locked).length }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="质量 (kg)" width="152" align="center">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.mass"
                    :min="0.0001"
                    :max="100000"
                    :precision="4"
                    :step="0.1"
                    controls-position="right"
                    style="width: 136px"
                    @change="onLinkMassChange(row as ResultRow)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="质心 (mm, 连杆系)" min-width="160" align="center">
                <template #default="{ row }">
                  {{ formatCom(row.linkId, row.com) }}
                </template>
              </el-table-column>
              <el-table-column label="主轴 quat (w,x,y,z, 连杆系)" min-width="210" align="center">
                <template #default="{ row }">
                  {{ formatQuat(row.linkId, row.inertia) }}
                </template>
              </el-table-column>
            </el-table>
            <p class="edit-hint">
              质心与 quat 均显示在该连杆自身坐标系下，与导出的 URDF / MJCF
              取值一致；修改连杆质量会按当前比例缩放该连杆内未锁定的 Solid；单独修改 Solid
              质量则连杆质量取各 Solid 之和；修改整机总质量只影响未锁定的 Solid。
            </p>
          </div>
        </div>

        <div class="inertia-footer">
          <el-button text @click="inertiaPanelVisible = false">关闭</el-button>
          <el-button
            type="primary"
            :loading="computing"
            :disabled="totalMass <= 0"
            @click="runCompute()"
          >
            {{ computedResults.length > 0 ? "重新计算" : "开始计算" }}
          </el-button>
          <el-button
            type="success"
            plain
            :disabled="computedResults.length === 0"
            @click="applyResults"
          >
            应用到所有连杆
          </el-button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { vHint } from "../composables/useHintBar";
import { useFloatingPanel } from "../composables/useFloatingPanel";
import Loading from "~icons/ep/loading";
import * as THREE from "three";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";
import { combineSolidInertia, principalAxisQuat } from "../../core/useInertiaWorker";
import { distributeInertia, type LinkInertiaInput } from "../../core/InertiaDistribution";
import { buildLinkRestInverses, toLinkLocalPoint } from "../../core/InertiaFrame";
import { rotateInertiaTensor } from "../../core/ZUpTransform";
import {
  UP_AXIS_OPTIONS,
  alignAllJointFramesToWorldZUp,
  type UpAxis,
} from "../../core/ZUpTransform";
import type { InertialParams, SolidMassEntry } from "../../types";

const emit = defineEmits<{
  (e: "rotateToZUp", up: UpAxis): void;
  (e: "resetOrientation"): void;
}>();

const currentUpAxis = ref<UpAxis>("Y+");

const urdfStore = useURDFStore();
const stepStore = useStepViewerStore();

function alignAllJointFrames(): void {
  const joints = urdfStore.robot.joints;
  if (joints.length === 0) {
    ElMessage.warning("尚未创建任何关节");
    return;
  }

  const applied = alignAllJointFramesToWorldZUp(joints);
  if (applied === 0) {
    ElMessage.warning("所有关节的旋转轴均为零向量，无法对齐");
    return;
  }

  const skipped = joints.length - applied;
  ElMessage.success(
    skipped > 0
      ? `已对齐 ${applied} 个关节坐标轴，${skipped} 个因旋转轴为零向量跳过`
      : `已将全部 ${applied} 个关节坐标轴对齐到全局 Z-up 右手系`,
  );
}

const restInverses = ref(new Map<string, THREE.Matrix4>());

function refreshRestInverses(): void {
  restInverses.value = buildLinkRestInverses(urdfStore.robot, {
    baseLinkId: urdfStore.BASE_LINK_ID,
    baseLinkOrigin: urdfStore.baseLinkOrigin,
    baseLinkRPY: urdfStore.baseLinkRPY,
  });
}

function formatCom(linkId: string, com: [number, number, number]): string {
  return toLinkLocalPoint(com, restInverses.value.get(linkId))
    .map((v) => v.toFixed(2))
    .join(", ");
}

function formatQuat(linkId: string, inertia: InertialParams["inertia"]): string {
  const inv = restInverses.value.get(linkId);
  const local = inv ? rotateInertiaTensor(inertia, inv) : inertia;
  const [x, y, z, w] = principalAxisQuat(local);
  return [w, x, y, z].map((v) => v.toFixed(4)).join(", ");
}

function formatVolume(vMm3: number): string {
  if (vMm3 >= 1e6) return `${(vMm3 / 1e6).toFixed(3)} dm³`;
  if (vMm3 >= 1e3) return `${(vMm3 / 1e3).toFixed(3)} cm³`;
  return `${vMm3.toFixed(1)} mm³`;
}

const inertiaPanelVisible = ref(false);

const { panelRef, handleRef, bringToFront } = useFloatingPanel({
  visible: inertiaPanelVisible,
  initial: ({ width, height }) => ({
    x: Math.max(16, width * 0.5 - 440),
    y: Math.max(40, height * 0.5 - 260),
  }),
});

const totalMass = computed({
  get: () => urdfStore.totalMass,
  set: (v: number) => {
    urdfStore.totalMass = v;
  },
});
const computing = ref(false);
const progressText = ref("");

interface ResultRow {
  linkId: string;
  name: string;
  mass: number;
  com: [number, number, number];
  inertia: InertialParams["inertia"];
  solids: SolidMassEntry[];
}
const computedResults = ref<ResultRow[]>([]);

function openInertiaPanel(): void {
  inertiaPanelVisible.value = true;
  refreshRestInverses();

  const hasExisting = urdfStore.robot.links.some((l) => l.solidIds.length > 0 && l.inertial);
  if (!hasExisting) {
    computedResults.value = [];
    return;
  }
  if (computedResults.value.length === 0) {
    runCompute(true);
  }
}

function recalcRow(row: ResultRow): void {
  const combined = combineSolidInertia(row.solids);
  row.mass = combined.mass;
  row.com = combined.com;
  row.inertia = combined.inertia;
}

function onLinkMassChange(row: ResultRow): void {
  const unlocked = row.solids.filter((s) => !s.locked);
  const lockedSum = row.solids.reduce((s, e) => s + (e.locked ? e.mass : 0), 0);
  const current = unlocked.reduce((s, e) => s + e.mass, 0);
  if (!Number.isFinite(row.mass) || row.mass <= 0) return;

  if (unlocked.length === 0) {
    ElMessage.warning("该连杆的所有 Solid 质量均已锁定，无法修改连杆质量");
    row.mass = lockedSum;
    recalcRow(row);
    return;
  }

  const residual = row.mass - lockedSum;
  if (residual <= 0) {
    ElMessage.warning(`该连杆已锁定 ${lockedSum.toFixed(4)} kg，连杆质量不能小于该值`);
    row.mass = lockedSum + current;
    recalcRow(row);
    return;
  }

  if (current > 0) {
    const k = residual / current;
    for (const s of unlocked) s.mass *= k;
  } else {
    const vol = unlocked.reduce((v, e) => v + e.volume, 0);
    for (const s of unlocked)
      s.mass = vol > 0 ? (s.volume / vol) * residual : residual / unlocked.length;
  }
  recalcRow(row);
}

function syncLockFlags(): void {
  for (const row of computedResults.value) {
    for (const s of row.solids) s.locked = urdfStore.isSolidMassLocked(s.solidId);
  }
}

function toggleSolidLock(entry: SolidMassEntry): void {
  const next = !entry.locked;
  entry.locked = next;
  urdfStore.setSolidMassLocked(entry.solidId, next);
}

function toggleLinkLock(row: ResultRow): void {
  const next = !row.solids.every((s) => s.locked);
  for (const s of row.solids) {
    s.locked = next;
    urdfStore.setSolidMassLocked(s.solidId, next);
  }
}

function clearAllLocks(): void {
  urdfStore.clearSolidMassLocks();
  syncLockFlags();
  ElMessage.success("已解除全部质量锁定");
}

const lockedCount = computed(() =>
  computedResults.value.reduce((n, r) => n + r.solids.filter((s) => s.locked).length, 0),
);

const lockedMassSum = computed(() =>
  computedResults.value.reduce(
    (m, r) => m + r.solids.reduce((s, e) => s + (e.locked ? e.mass : 0), 0),
    0,
  ),
);

function redistributeByVolume(): boolean {
  if (computedResults.value.length === 0) return false;

  let lockedSum = 0;
  let unlockedVolume = 0;
  for (const row of computedResults.value) {
    for (const s of row.solids) {
      if (s.locked) lockedSum += s.mass;
      else unlockedVolume += s.volume;
    }
  }

  const residual = totalMass.value - lockedSum;
  if (residual < 0) {
    ElMessage.error(
      `已锁定质量合计 ${lockedSum.toFixed(3)} kg，超过整机总质量 ${totalMass.value.toFixed(3)} kg`,
    );
    return false;
  }
  if (unlockedVolume <= 0) {
    ElMessage.warning("所有 Solid 质量均已锁定，总质量修改不会生效");
    return false;
  }

  for (const row of computedResults.value) {
    for (const s of row.solids) {
      if (s.locked) continue;
      s.mass = (s.volume / unlockedVolume) * residual;
    }
    recalcRow(row);
  }
  return true;
}

function onRedistributeClick(): void {
  if (redistributeByVolume()) {
    ElMessage.success(
      lockedCount.value > 0
        ? `已按体积比重新分配未锁定质量（保留 ${lockedCount.value} 个锁定 Solid）`
        : "已按体积比重新分配质量",
    );
  }
}

watch(totalMass, () => {
  if (computedResults.value.length === 0 || computing.value) return;
  redistributeByVolume();
});

const computedMassSum = computed(() => computedResults.value.reduce((s, r) => s + r.mass, 0));

const massMismatch = computed(() => {
  if (computedResults.value.length === 0) return 0;
  return computedMassSum.value - totalMass.value;
});

async function runCompute(silent = false): Promise<void> {
  if (computing.value) return;

  const lockedMass = new Map<string, number>();
  for (const row of computedResults.value) {
    for (const s of row.solids) {
      if (s.locked && s.mass > 0) lockedMass.set(s.solidId, s.mass);
    }
  }
  if (lockedMass.size === 0) {
    for (const l of urdfStore.robot.links) {
      if (!l.solidMasses) continue;
      for (const [sid, m] of Object.entries(l.solidMasses)) {
        if (m > 0 && urdfStore.isSolidMassLocked(sid)) lockedMass.set(sid, m);
      }
    }
  }

  computing.value = true;
  progressText.value = "正在收集几何数据…";
  computedResults.value = [];

  try {
    const linkInputs: LinkInertiaInput[] = [];
    for (const l of urdfStore.robot.links) {
      if (l.solidIds.length === 0) continue;
      const pairs: LinkInertiaInput["pairs"] = [];
      for (const sid of l.solidIds) {
        const solid = stepStore.solidMap.get(sid);
        if (solid?.serializedData) {
          pairs.push({ solidId: sid, solidName: solid.name, data: solid.serializedData });
        }
      }
      if (pairs.length > 0) linkInputs.push({ linkId: l.id, name: l.name, pairs });
    }

    if (linkInputs.length === 0) {
      if (!silent) ElMessage.warning("没有绑定几何体的连杆，无法计算");
      return;
    }

    const solidCount = linkInputs.reduce((s, l) => s + l.pairs.length, 0);
    progressText.value = `正在计算 ${linkInputs.length} 个连杆 / ${solidCount} 个 Solid 的参考惯量…`;

    const newResults = await distributeInertia(
      linkInputs,
      totalMass.value,
      lockedMass.size > 0 ? lockedMass : undefined,
    );

    if (newResults.length === 0) {
      ElMessage.warning("计算结果为空，请检查各连杆是否绑定了有效的几何体");
      return;
    }

    computedResults.value = newResults;
    syncLockFlags();
    refreshRestInverses();

    if (!silent) {
      const hint = lockedMass.size > 0 ? `（已锁定 ${lockedMass.size} 个 Solid 的质量）` : "";
      ElMessage.success(`计算完成，共 ${newResults.length} 个连杆 / ${solidCount} 个 Solid${hint}`);
    }
  } catch (e) {
    ElMessage.error(`计算失败: ${(e as Error).message}`);
  } finally {
    computing.value = false;
    progressText.value = "";
  }
}

function applyResults(): void {
  let count = 0;
  for (const row of computedResults.value) {
    urdfStore.setLinkInertial(row.linkId, {
      mass: row.mass,
      com: row.com,
      inertia: row.inertia,
    });
    urdfStore.setLinkSolidMasses(
      row.linkId,
      Object.fromEntries(row.solids.map((s) => [s.solidId, s.mass])),
    );
    count++;
  }
  ElMessage.success(`已将惯性参数应用到 ${count} 个连杆`);
  inertiaPanelVisible.value = false;
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
  color: var(--text-1);
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
  color: var(--text-2);
  flex-shrink: 0;
  width: 26px;
  text-align: right;
}

.zup-divider {
  margin: 8px 0 4px;
}

.zup-hint {
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
}

.zup-axis-row {
  padding-top: 0;
}

.zup-actions {
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.param-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text-1);
  width: 80px;
}

.param-unit {
  font-size: 12px;
  color: var(--text-2);
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--accent);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-2);
  text-align: center;
  padding: 12px 0;
}

.result-section {
  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .result-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-1);
  }

  .edit-hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-2);
  }
}

.solid-detail {
  padding: 6px 12px 8px 40px;
  background: var(--el-fill-color-lighter);
}

.solid-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.solid-detail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.solid-lock-btn {
  width: 24px;
  min-width: 24px;
  padding: 0;
  flex-shrink: 0;
}

.lock-badge {
  font-size: 11px;
  color: var(--text-2);
  margin-left: 2px;
}

.solid-mass-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 3px 0;
}

.solid-mass-name {
  font-size: 12px;
  color: var(--text-1);
  width: 150px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-locked {
    color: var(--el-color-warning);
    font-weight: 600;
  }
}

.solid-mass-vol {
  font-size: 11px;
  color: var(--text-2);
  font-family: monospace;
  width: 96px;
  flex-shrink: 0;
  text-align: right;
}

.solid-mass-unit {
  font-size: 11px;
  color: var(--text-2);
  flex-shrink: 0;
}

.solid-mass-com {
  font-size: 11px;
  color: var(--text-2);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--line-strong);
    border-radius: 2px;
  }
}

.inertia-panel {
  width: 880px;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
}

.inertia-body {
  padding: 12px;
}

.inertia-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--line-strong);
  flex-shrink: 0;
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
