<template>
  <Teleport to="body">
    <div
      v-show="urdfStore.jointWizardVisible"
      class="joint-wizard-panel"
      ref="panelRef"
      @pointerdown="bringToFront"
    >
      <div class="panel-header" ref="handleRef">
        <span class="panel-title">⚙️ 创建关节</span>
        <div class="panel-actions">
          <el-tag v-if="pickedEdgeInfo" type="success" size="small">{{ pickedEdgeInfo }}</el-tag>
          <el-button size="small" text @click="handleClose">✕</el-button>
        </div>
      </div>

      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">Parent:</span>
          <el-select v-model="parentLinkId" placeholder="Parent Link" size="small" style="flex: 1">
            <el-option
              v-for="l in urdfStore.robot.links"
              :key="l.id"
              :label="l.name"
              :value="l.id"
            />
          </el-select>
        </div>
        <div class="field-row">
          <span class="field-label">Child:</span>
          <el-select v-model="childLinkId" placeholder="Child Link" size="small" style="flex: 1">
            <el-option
              v-for="l in availableChildLinks"
              :key="l.id"
              :label="l.name"
              :value="l.id"
              :disabled="l.id === parentLinkId"
            />
          </el-select>
        </div>

        <div class="candidate-block">
          <div class="candidate-head">
            <span class="candidate-title">推荐旋转轴</span>
            <el-tag v-if="candidates.length" size="small" type="info"
              >{{ candidates.length }} 个</el-tag
            >
            <el-button size="small" text :disabled="!canDetect" @click="detectCandidates"
              >重新识别</el-button
            >
          </div>
          <div v-if="!canDetect" class="candidate-empty">请先选择 Parent 与 Child</div>
          <div v-else-if="candidates.length === 0" class="candidate-empty">
            未识别到同轴特征，请在 3D 中手动拾取
          </div>
          <ul v-else class="candidate-list">
            <li
              v-for="(c, i) in candidates"
              :key="c.id"
              class="candidate-item"
              :class="{ active: activeCandidateId === c.id }"
              @mouseenter="handleCandidateHover(c)"
              @mouseleave="handleCandidateLeave"
              @click="applyCandidate(c)"
            >
              <span class="candidate-rank">{{ i + 1 }}</span>
              <span class="candidate-size">{{ c.label }}</span>
              <span class="candidate-detail">{{ c.detail }}</span>
              <el-tag v-if="c.fitted" size="small" type="success" effect="plain">配合</el-tag>
            </li>
          </ul>
        </div>

        <div class="pick-hint">
          <el-tag size="small" type="warning">🎯 或直接点击 3D 圆弧边 / 圆柱面拾取轴线</el-tag>
          <div class="pick-tools">
            <el-button
              v-hint="'半透明显示模型，方便看到内部孔与轴'"
              size="small"
              :type="xray ? 'primary' : 'default'"
              @click="toggleXray"
            >
              {{ xray ? "透视中" : "透视" }}
            </el-button>
            <span class="pick-cycle">
              光标下 {{ candidateInfo.total || 0 }} 个特征
              <el-button
                size="small"
                text
                :disabled="candidateInfo.total < 2"
                @click="emit('cycleCandidate', 1)"
              >
                切换 (Tab)
              </el-button>
            </span>
          </div>
          <div v-if="candidateInfo.description" class="pick-current">
            当前: {{ candidateInfo.description }}
          </div>
          <div v-if="hasSnap" class="flip-row">
            <span class="flip-label">反转轴向</span>
            <el-button-group>
              <el-button size="small" @click="handleFlipAxis('x')">🔄 X</el-button>
              <el-button size="small" @click="handleFlipAxis('y')">🔄 Y</el-button>
              <el-button size="small" type="primary" @click="handleFlipAxis('z')">🔄 Z</el-button>
            </el-button-group>
          </div>
        </div>

        <div v-if="hasSnap" class="offset-block">
          <div class="field-row">
            <span class="field-label">沿轴:</span>
            <el-slider
              v-model="axisOffset"
              :min="offsetRange[0]"
              :max="offsetRange[1]"
              :step="offsetStep"
              size="small"
              style="flex: 1; margin-right: 8px"
              @input="refreshGizmo"
              @change="handleOffsetChange"
            />
            <el-input-number
              v-model="axisOffset"
              size="small"
              :step="offsetStep"
              :precision="3"
              controls-position="right"
              style="width: 110px"
              @change="handleOffsetChange"
            />
          </div>
          <div v-if="snapPointOptions.length" class="field-row">
            <span class="field-label">吸附:</span>
            <el-select
              v-model="selectedSnapPoint"
              size="small"
              style="flex: 1"
              placeholder="吸附到同轴特征"
              clearable
              @change="handleSnapPointChange"
            >
              <el-option
                v-for="(sp, i) in snapPointOptions"
                :key="i"
                :label="sp.label"
                :value="sp.t"
              />
            </el-select>
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">Origin:</span>
          <div class="vec3-inputs">
            <el-input-number
              v-model="originXYZ[0]"
              size="small"
              :step="0.001"
              :precision="6"
              controls-position="right"
            />
            <el-input-number
              v-model="originXYZ[1]"
              size="small"
              :step="0.001"
              :precision="6"
              controls-position="right"
            />
            <el-input-number
              v-model="originXYZ[2]"
              size="small"
              :step="0.001"
              :precision="6"
              controls-position="right"
            />
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">RPY:</span>
          <div class="vec3-inputs">
            <el-input-number
              v-model="originRPY[0]"
              size="small"
              :step="0.01"
              :precision="6"
              controls-position="right"
            />
            <el-input-number
              v-model="originRPY[1]"
              size="small"
              :step="0.01"
              :precision="6"
              controls-position="right"
            />
            <el-input-number
              v-model="originRPY[2]"
              size="small"
              :step="0.01"
              :precision="6"
              controls-position="right"
            />
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">Axis:</span>
          <div class="vec3-inputs">
            <el-input-number
              v-model="axis[0]"
              size="small"
              :step="0.01"
              :precision="6"
              :min="-1"
              :max="1"
              controls-position="right"
            />
            <el-input-number
              v-model="axis[1]"
              size="small"
              :step="0.01"
              :precision="6"
              :min="-1"
              :max="1"
              controls-position="right"
            />
            <el-input-number
              v-model="axis[2]"
              size="small"
              :step="0.01"
              :precision="6"
              :min="-1"
              :max="1"
              controls-position="right"
            />
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">Type:</span>
          <el-select v-model="jointType" size="small" style="flex: 1">
            <el-option label="Revolute" value="revolute" />
            <el-option label="Prismatic" value="prismatic" />
            <el-option label="Continuous" value="continuous" />
            <el-option label="Ball（球关节）" value="ball" />
            <el-option label="Planar（平面）" value="planar" />
            <el-option label="Floating（自由）" value="floating" />
            <el-option label="Fixed" value="fixed" />
            <el-option label="Continuous" value="continuous" />
          </el-select>
        </div>
        <div class="field-row">
          <span class="field-label">Name:</span>
          <el-input v-model="jointName" placeholder="自动生成" size="small" style="flex: 1" />
        </div>

        <template v-if="jointType !== 'fixed'">
          <div class="limits-header">限位</div>
          <div class="field-row">
            <span class="field-label">Lower:</span>
            <el-input-number
              v-model="limits.lower"
              size="small"
              :step="0.1"
              :precision="4"
              controls-position="right"
            />
            <el-button size="small" text @click="limits.lower = -Math.PI">-π</el-button>
          </div>
          <div class="field-row">
            <span class="field-label">Upper:</span>
            <el-input-number
              v-model="limits.upper"
              size="small"
              :step="0.1"
              :precision="4"
              controls-position="right"
            />
            <el-button size="small" text @click="limits.upper = Math.PI">π</el-button>
          </div>
          <div class="field-row">
            <span class="field-label">Effort:</span>
            <el-input-number
              v-model="limits.effort"
              size="small"
              :step="1"
              :precision="1"
              controls-position="right"
            />
          </div>
          <div class="field-row">
            <span class="field-label">Velocity:</span>
            <el-input-number
              v-model="limits.velocity"
              size="small"
              :step="0.1"
              :precision="2"
              controls-position="right"
            />
          </div>
        </template>
      </div>

      <div class="panel-footer">
        <el-button size="small" @click="handleClose">取消</el-button>
        <el-button size="default" type="success" :disabled="!canCreate" @click="handleCreate">
          创建关节</el-button
        >
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { vHint } from "../composables/useHintBar";
import { useFloatingPanel } from "../composables/useFloatingPanel";
import * as THREE from "three";
import { ElMessage } from "element-plus";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";
import { computeRelativeTransform } from "../../core/useKinematicsWorker";
import {
  buildAxisFrame,
  flipAxisFrame,
  frameToArray,
  type AxisFrame,
  type FrameAxis,
} from "../../core/AxisFrame";
import { collectAxisCandidates, type AxisCandidate } from "../../core/AxisCandidate";
import type { JointType, GeometryFeature, SolidObject } from "../../types";

const urdfStore = useURDFStore();
const stepStore = useStepViewerStore();

const emit = defineEmits<{
  (e: "created", jointId: string): void;
  (e: "startEdgePick"): void;
  (e: "stopEdgePick"): void;
  (e: "flipAxis", axis: FrameAxis): void;
  (e: "previewAxis", candidate: AxisCandidate | null, t?: number): void;
  (e: "showGizmo", position: [number, number, number], direction: [number, number, number]): void;
  (e: "cycleCandidate", step: number): void;
  (e: "toggleXray", active: boolean): void;
}>();

const { panelRef, handleRef, bringToFront } = useFloatingPanel({
  visible: () => urdfStore.jointWizardVisible,
  initial: ({ width }) => ({ x: Math.max(12, width - 420), y: 80 }),
});

const parentLinkId = ref("");
const childLinkId = ref("");
const originXYZ = reactive<[number, number, number]>([0, 0, 0]);
const originRPY = reactive<[number, number, number]>([0, 0, 0]);
const axis = reactive<[number, number, number]>([0, 0, 1]);
const jointName = ref("");
const jointType = ref<JointType>("revolute");
const limits = reactive({ lower: -3.14159, upper: 3.14159, effort: 100, velocity: 1 });
const pickedEdgeInfo = ref("");

const axisBase = reactive<[number, number, number]>([0, 0, 0]);
const axisDir0 = reactive<[number, number, number]>([0, 0, 1]);
const axisOffset = ref(0);
const offsetRange = reactive<[number, number]>([-1, 1]);
const offsetStep = ref(0.01);
const snapPointOptions = ref<{ t: number; label: string }[]>([]);
const selectedSnapPoint = ref<number | null>(null);
const cachedFrame = ref<AxisFrame | null>(null);

const candidates = ref<AxisCandidate[]>([]);
const activeCandidateId = ref<string | null>(null);
const candidateInfo = reactive({ index: 0, total: 0, description: "" });
const xray = ref(false);

const availableChildLinks = computed(() => {
  const usedChildIds = new Set(urdfStore.robot.joints.map((j) => j.childLinkId));
  return urdfStore.robot.links.filter(
    (l) => !usedChildIds.has(l.id) && !urdfStore.isBaseLink(l.id),
  );
});

const canCreate = computed(() => {
  return parentLinkId.value && childLinkId.value && parentLinkId.value !== childLinkId.value;
});

const canDetect = computed(() => {
  return !!parentLinkId.value && !!childLinkId.value && parentLinkId.value !== childLinkId.value;
});

const hasSnap = computed(() => cachedFrame.value !== null);

function getLinkSolids(linkId: string): SolidObject[] {
  const link = urdfStore.linkMap.get(linkId);
  if (!link) return [];
  const list: SolidObject[] = [];
  for (const id of link.solidIds) {
    const s = stepStore.solidMap.get(id);
    if (s) list.push(s);
  }
  return list;
}

function computeScale(solids: SolidObject[]): number {
  const box = new THREE.Box3();
  for (const s of solids) {
    if (s.boundingBox) {
      box.expandByPoint(s.boundingBox.min);
      box.expandByPoint(s.boundingBox.max);
    }
  }
  if (box.isEmpty()) return 100;
  const d = box.getSize(new THREE.Vector3()).length();
  return d > 0 ? d : 100;
}

function detectCandidates(): void {
  if (!canDetect.value) {
    candidates.value = [];
    return;
  }
  const parentSolids = getLinkSolids(parentLinkId.value);
  const childSolids = getLinkSolids(childLinkId.value);
  candidates.value = collectAxisCandidates({ parentSolids, childSolids });
}

function handleCandidateHover(c: AxisCandidate): void {
  emit("previewAxis", c, c.originT);
}

function handleCandidateLeave(): void {
  if (activeCandidateId.value) {
    emit("previewAxis", null);
    refreshGizmo();
  } else {
    emit("previewAxis", null);
  }
}

async function applyCandidate(c: AxisCandidate): Promise<void> {
  activeCandidateId.value = c.id;
  axisBase[0] = c.basePoint[0];
  axisBase[1] = c.basePoint[1];
  axisBase[2] = c.basePoint[2];
  axisDir0[0] = c.dir[0];
  axisDir0[1] = c.dir[1];
  axisDir0[2] = c.dir[2];

  const span = Math.max(c.tMax - c.tMin, 1e-6);
  const pad = Math.max(span * 0.6, span + 1);
  offsetRange[0] = round4(c.tMin - pad);
  offsetRange[1] = round4(c.tMax + pad);
  offsetStep.value = round4(Math.max((offsetRange[1] - offsetRange[0]) / 500, 1e-4));
  axisOffset.value = round4(c.originT);
  snapPointOptions.value = c.snapPoints.map((sp) => ({ t: round4(sp.t), label: sp.label }));
  selectedSnapPoint.value = null;

  cachedFrame.value = buildAxisFrame([...c.dir] as [number, number, number]);
  pickedEdgeInfo.value = `${c.label} · ${c.detail}`;

  await applyCurrentAxis();
}

async function applyPickedEdge(feature: GeometryFeature): Promise<void> {
  let snapPos: [number, number, number];
  let snapNorm: [number, number, number];

  if (feature.edgeCurveType === "line") {
    if (!feature.startPoint || !feature.endPoint) return;
    const dir = feature.endPoint.clone().sub(feature.startPoint).normalize();
    snapPos = [feature.startPoint.x, feature.startPoint.y, feature.startPoint.z];
    snapNorm = [dir.x, dir.y, dir.z];
    pickedEdgeInfo.value = "直线";
  } else {
    const norm = feature.axis || feature.normal;
    if (!feature.center || !norm) return;
    const n = norm.clone().normalize();
    snapPos = [feature.center.x, feature.center.y, feature.center.z];
    snapNorm = [n.x, n.y, n.z];
    pickedEdgeInfo.value = feature.edgeCurveType || feature.type;
  }

  activeCandidateId.value = null;
  axisBase[0] = snapPos[0];
  axisBase[1] = snapPos[1];
  axisBase[2] = snapPos[2];
  axisDir0[0] = snapNorm[0];
  axisDir0[1] = snapNorm[1];
  axisDir0[2] = snapNorm[2];

  const scale = computeScale([
    ...getLinkSolids(parentLinkId.value),
    ...getLinkSolids(childLinkId.value),
  ]);
  offsetRange[0] = round4(-scale * 0.5);
  offsetRange[1] = round4(scale * 0.5);
  offsetStep.value = round4(Math.max(scale / 500, 1e-4));
  axisOffset.value = 0;
  snapPointOptions.value = collectCoaxialSnapPoints(snapPos, snapNorm);
  selectedSnapPoint.value = null;

  cachedFrame.value = buildAxisFrame(snapNorm);

  await applyCurrentAxis();
}

function collectCoaxialSnapPoints(
  base: [number, number, number],
  dir: [number, number, number],
): { t: number; label: string }[] {
  if (!canDetect.value) return [];
  const solids = [...getLinkSolids(parentLinkId.value), ...getLinkSolids(childLinkId.value)];
  const list = collectAxisCandidates({ parentSolids: solids, childSolids: [] });
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const b = new THREE.Vector3(base[0], base[1], base[2]);

  for (const c of list) {
    const cd = new THREE.Vector3(c.dir[0], c.dir[1], c.dir[2]);
    if (Math.abs(cd.dot(d)) < Math.cos((1.5 * Math.PI) / 180)) continue;
    const cb = new THREE.Vector3(c.basePoint[0], c.basePoint[1], c.basePoint[2]);
    const delta = cb.clone().sub(b);
    const radial = delta.clone().addScaledVector(d, -delta.dot(d));
    if (radial.length() > Math.max(0.05, c.radii[0] * 0.02)) continue;

    return c.snapPoints.map((sp) => {
      const world = cb.clone().addScaledVector(cd, sp.t);
      const t = world.sub(b).dot(d);
      return { t: round4(t), label: `Ø${(sp.radius * 2).toFixed(2)} @ ${t.toFixed(2)}` };
    });
  }
  return [];
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function currentWorldPosition(): [number, number, number] {
  return [
    axisBase[0] + axisDir0[0] * axisOffset.value,
    axisBase[1] + axisDir0[1] * axisOffset.value,
    axisBase[2] + axisDir0[2] * axisOffset.value,
  ];
}

function refreshGizmo(): void {
  if (!cachedFrame.value) return;
  emit("showGizmo", currentWorldPosition(), [...cachedFrame.value.z] as [number, number, number]);
}

async function handleOffsetChange(): Promise<void> {
  if (!cachedFrame.value) return;
  await applyCurrentAxis();
}

async function handleSnapPointChange(value: number | null): Promise<void> {
  if (value === null || value === undefined) return;
  axisOffset.value = value;
  await applyCurrentAxis();
}

function toggleXray(): void {
  xray.value = !xray.value;
  emit("toggleXray", xray.value);
}

async function handleFlipAxis(axisName: FrameAxis): Promise<void> {
  if (!cachedFrame.value) return;

  cachedFrame.value = flipAxisFrame(cachedFrame.value, axisName);
  emit("flipAxis", axisName);
  await applyCurrentAxis();
}

async function applyCurrentAxis(): Promise<void> {
  if (!cachedFrame.value) return;
  const pos = currentWorldPosition();
  const norm = [...cachedFrame.value.z] as [number, number, number];
  await applySnapToForm(pos, norm, cachedFrame.value);
  refreshGizmo();
}

function handleCreate(): void {
  const result = urdfStore.addJoint({
    name: jointName.value || undefined,
    type: jointType.value,
    parentLinkId: parentLinkId.value,
    childLinkId: childLinkId.value,
    origin: {
      xyz: [...originXYZ] as [number, number, number],
      rpy: [...originRPY] as [number, number, number],
    },
    axis: [...axis] as [number, number, number],
    limits: { ...limits },
  });
  if (!result.ok) {
    ElMessage.warning(result.reason);
    return;
  }
  emit("created", result.joint.id);
  handleClose();
}

function handleClose(): void {
  if (xray.value) {
    xray.value = false;
    emit("toggleXray", false);
  }
  emit("stopEdgePick");
  urdfStore.jointWizardVisible = false;
  urdfStore.jointWizardStep = "select-links";
  resetForm();
}

function resetForm(): void {
  parentLinkId.value = "";
  childLinkId.value = "";
  originXYZ[0] = originXYZ[1] = originXYZ[2] = 0;
  originRPY[0] = originRPY[1] = originRPY[2] = 0;
  axis[0] = 0;
  axis[1] = 0;
  axis[2] = 1;
  jointName.value = "";
  jointType.value = "revolute";
  limits.lower = -3.14159;
  limits.upper = 3.14159;
  limits.effort = 100;
  limits.velocity = 1;
  pickedEdgeInfo.value = "";
  cachedFrame.value = null;
  candidates.value = [];
  activeCandidateId.value = null;
  axisOffset.value = 0;
  snapPointOptions.value = [];
  selectedSnapPoint.value = null;
  candidateInfo.index = 0;
  candidateInfo.total = 0;
  candidateInfo.description = "";
  xray.value = false;
}

async function applySnapToForm(
  snapPos: [number, number, number],
  snapNorm: [number, number, number],
  frame?: AxisFrame | null,
): Promise<void> {
  const parentWorld = parentLinkId.value
    ? urdfStore.linkWorldTransforms.get(parentLinkId.value)
    : null;
  const parentElements = parentWorld ? parentWorld.elements : new THREE.Matrix4().elements;

  const result = await computeRelativeTransform(
    parentElements,
    snapPos,
    snapNorm,
    frame ? frameToArray(frame) : undefined,
  );

  originXYZ[0] = result.xyz[0];
  originXYZ[1] = result.xyz[1];
  originXYZ[2] = result.xyz[2];
  originRPY[0] = result.rpy[0];
  originRPY[1] = result.rpy[1];
  originRPY[2] = result.rpy[2];
  axis[0] = 0;
  axis[1] = 0;
  axis[2] = 1;
}

function setCandidateInfo(info: { index: number; total: number; description: string }): void {
  candidateInfo.index = info.index;
  candidateInfo.total = info.total;
  candidateInfo.description = info.description;
}

watch([parentLinkId, childLinkId], () => {
  activeCandidateId.value = null;
  detectCandidates();
});

defineExpose({ applyPickedEdge, setCandidateInfo });

watch(
  () => urdfStore.jointWizardVisible,
  (vis) => {
    if (vis) {
      resetForm();
      position.x = window.innerWidth - 420;
      position.y = 80;
      emit("startEdgePick");
    } else {
      emit("stopEdgePick");
    }
  },
);
</script>

<style lang="scss" scoped>
.joint-wizard-panel {
  position: fixed;
  width: 390px;
  background: var(--panel-face);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.42);
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
  background: var(--panel-bar);
  border-bottom: 1px solid var(--line-strong);
  cursor: move;
  user-select: none;
  touch-action: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.panel-title {
  font-size: 13px;
  color: var(--text-1);
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

.candidate-block {
  margin: 6px 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--surface-1);
}

.candidate-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.candidate-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
  flex: 1;
}

.candidate-empty {
  font-size: 11px;
  color: var(--text-2);
  padding: 4px 0;
}

.candidate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 150px;
  overflow-y: auto;
}

.candidate-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: rgba(255, 173, 50, 0.1);
  }

  &.active {
    background: #d9ecff;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
}

.candidate-rank {
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 50%;
  background: #c0c4cc;
  color: #fff;
  font-size: 10px;
  flex-shrink: 0;
}

.candidate-size {
  font-weight: 600;
  color: #303133;
  min-width: 56px;
}

.candidate-detail {
  color: var(--text-2);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.pick-cycle {
  font-size: 11px;
  color: var(--text-2);
}

.pick-current {
  font-size: 11px;
  color: var(--accent);
  margin-top: 4px;
}

.offset-block {
  margin: 6px 0 8px;
  padding: 6px 8px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
}

.flip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.flip-label {
  font-size: 11px;
  color: var(--text-2);
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
  color: var(--text-2);
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
