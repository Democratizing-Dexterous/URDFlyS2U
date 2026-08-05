<template>
  <div class="joint-properties" v-if="joint">
    <div class="joint-path">
      <span class="path-link">{{ parentLinkName }}</span>
      <el-icon>
        <ArrowRight />
      </el-icon>
      <span class="path-joint">{{ joint.name }}</span>
      <el-icon>
        <ArrowRight />
      </el-icon>
      <span class="path-link">{{ childLinkName }}</span>
    </div>

    <el-collapse v-model="openPanels">
      <el-collapse-item name="basic">
        <template #title>
          <span class="section-title">基本信息</span>
        </template>
        <div class="prop-form">
          <div class="prop-row">
            <span class="prop-label">名称</span>
            <el-input v-model="joint.name" size="small" placeholder="joint name" />
          </div>
          <div class="prop-row">
            <span class="prop-label">类型</span>
            <el-select
              v-model="joint.type"
              size="small"
              style="width: 150px"
              @change="handleTypeChange"
            >
              <el-option
                v-for="opt in JOINT_TYPE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </div>
      </el-collapse-item>

      <el-collapse-item name="origin">
        <template #title>
          <span class="section-title">原点 (Origin)</span>
        </template>
        <div class="prop-form">
          <div class="pick-row">
            <el-button
              v-if="!urdfStore.edgePickEditJointId"
              type="warning"
              plain
              @click="handleStartEdgePick"
            >
              拾取圆边/直线
            </el-button>
            <template v-else>
              <el-button type="danger" plain @click="handleStopEdgePick"> ✕ 停止拾取 </el-button>
            </template>
          </div>

          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number
              v-model="joint.origin.xyz[0]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.origin.xyz[1]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.origin.xyz[2]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
          </div>

          <div class="coord-row">
            <span class="coord-label">rpy</span>
            <el-input-number
              v-model="joint.origin.rpy[0]"
              size="small"
              :step="0.01"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.origin.rpy[1]"
              size="small"
              :step="0.01"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.origin.rpy[2]"
              size="small"
              :step="0.01"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
          </div>

          <div class="flip-row">
            <span class="flip-label">反转坐标轴</span>
            <el-button-group>
              <el-button size="small" @click="flipFrame('x')">🔄 X</el-button>
              <el-button size="small" @click="flipFrame('y')">🔄 Y</el-button>
              <el-button size="small" type="primary" @click="flipFrame('z')">🔄 Z</el-button>
            </el-button-group>
          </div>

          <el-button
            v-hint="
              '坐标轴统一对齐全局 Z-up 右手系（rpy 归零），旋转轴改用向量单独表达；轴心位置、轴在空间中的指向与转动方向均不变，下游关节自动补偿'
            "
            size="small"
            text
            type="primary"
            style="margin-top: 4px"
            @click="alignFrameToWorldZUp"
          >
            🧭 坐标轴对齐全局 Z-up
          </el-button>
        </div>
      </el-collapse-item>

      <el-collapse-item name="axis">
        <template #title>
          <span class="section-title">旋转轴 (Axis)</span>
        </template>
        <div class="prop-form">
          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number
              v-model="joint.axis[0]"
              size="small"
              :step="0.01"
              :precision="4"
              :min="-1"
              :max="1"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.axis[1]"
              size="small"
              :step="0.01"
              :precision="4"
              :min="-1"
              :max="1"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.axis[2]"
              size="small"
              :step="0.01"
              :precision="4"
              :min="-1"
              :max="1"
              controls-position="right"
              style="width: 82px"
            />
          </div>
          <el-button size="small" text type="primary" @click="flipAxis" style="margin-top: 4px">
            ↔ 反转轴方向
          </el-button>
        </div>
      </el-collapse-item>

      <el-collapse-item name="axisOffset">
        <template #title>
          <span class="section-title">轴偏移 (Axis Offset)</span>
        </template>
        <div class="prop-form">
          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number
              v-model="joint.axisOffset[0]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.axisOffset[1]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
            <el-input-number
              v-model="joint.axisOffset[2]"
              size="small"
              :step="0.001"
              :precision="4"
              controls-position="right"
              style="width: 82px"
            />
          </div>
          <el-button size="small" text type="info" @click="resetAxisOffset" style="margin-top: 4px">
            重置偏移
          </el-button>
        </div>
      </el-collapse-item>

      <el-collapse-item v-if="showLimits" name="limits">
        <template #title>
          <span class="section-title">限制 (Limits)</span>
        </template>
        <div class="prop-form">
          <div class="prop-row">
            <span class="prop-label">下限</span>
            <el-input-number
              v-model="joint.limits.lower"
              size="small"
              :step="isLinearJoint ? 1 : 0.1"
              :precision="3"
              controls-position="right"
              style="width: 120px"
            />
            <span class="prop-unit">{{ isLinearJoint ? "mm" : "rad" }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">上限</span>
            <el-input-number
              v-model="joint.limits.upper"
              size="small"
              :step="isLinearJoint ? 1 : 0.1"
              :precision="3"
              controls-position="right"
              style="width: 120px"
            />
            <span class="prop-unit">{{ isLinearJoint ? "mm" : "rad" }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">力度</span>
            <el-input-number
              v-model="joint.limits.effort"
              size="small"
              :step="1"
              :precision="1"
              controls-position="right"
              style="width: 120px"
            />
            <span class="prop-unit">{{ isLinearJoint ? "N" : "N·m" }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">速度</span>
            <el-input-number
              v-model="joint.limits.velocity"
              size="small"
              :step="isLinearJoint ? 1 : 0.1"
              :precision="2"
              controls-position="right"
              style="width: 120px"
            />
            <span class="prop-unit">{{ isLinearJoint ? "mm/s" : "rad/s" }}</span>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>

  <div v-else class="empty-hint">未选中任何关节</div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { vHint } from "../composables/useHintBar";
import ArrowRight from "~icons/ep/arrow-right";
import { ElMessage } from "element-plus";
import { useURDFStore } from "../../stores/useURDFStore";
import { flipRPY, type FrameAxis } from "../../core/AxisFrame";
import { applyWorldAlignedJointFrame } from "../../core/ZUpTransform";
import { JOINT_TYPE_OPTIONS, isLimitedJoint } from "../../types";
import type { JointType } from "../../types";

const urdfStore = useURDFStore();

const openPanels = ref<string[]>(["basic", "origin", "axis", "axisOffset", "limits"]);

const joint = computed(() => {
  if (!urdfStore.selectedJointId) return null;
  return urdfStore.jointMap.get(urdfStore.selectedJointId) ?? null;
});

const parentLinkName = computed(() =>
  joint.value
    ? (urdfStore.linkMap.get(joint.value.parentLinkId)?.name ?? joint.value.parentLinkId)
    : "",
);

const childLinkName = computed(() =>
  joint.value
    ? (urdfStore.linkMap.get(joint.value.childLinkId)?.name ?? joint.value.childLinkId)
    : "",
);

const isLinearJoint = computed(
  () => joint.value?.type === "prismatic" || joint.value?.type === "planar",
);

const showLimits = computed(() => !!joint.value && isLimitedJoint(joint.value.type));

function handleTypeChange(type: JointType): void {
  if (!joint.value) return;
  const defaultLimits =
    type === "prismatic" || type === "planar"
      ? { lower: -100, upper: 100, effort: 100, velocity: 100 }
      : { lower: -3.14159, upper: 3.14159, effort: 10, velocity: 1 };
  urdfStore.updateJoint(joint.value.id, { type, limits: defaultLimits });
}

function handleStartEdgePick(): void {
  if (!joint.value) return;
  urdfStore.edgePickEditJointId = joint.value.id;
}

function handleStopEdgePick(): void {
  urdfStore.edgePickEditJointId = null;
}

function flipAxis(): void {
  if (!joint.value) return;
  joint.value.axis = [-joint.value.axis[0], -joint.value.axis[1], -joint.value.axis[2]] as [
    number,
    number,
    number,
  ];
}

function resetAxisOffset(): void {
  if (!joint.value) return;
  joint.value.axisOffset = [0, 0, 0];
}

function flipFrame(axis: FrameAxis): void {
  if (!joint.value) return;
  joint.value.origin.rpy = flipRPY(joint.value.origin.rpy, axis);
}

function alignFrameToWorldZUp(): void {
  const target = joint.value;
  if (!target) return;

  const before = {
    rpy: [...target.origin.rpy] as [number, number, number],
    axis: [...target.axis] as [number, number, number],
  };

  if (!applyWorldAlignedJointFrame(urdfStore.robot.joints, target)) {
    ElMessage.warning("关节轴为零向量，无法确定旋转轴方向");
    return;
  }

  const unchanged =
    target.origin.rpy.every((v, i) => Math.abs(v - before.rpy[i]) < 1e-9) &&
    target.axis.every((v, i) => Math.abs(v - before.axis[i]) < 1e-9);
  if (unchanged) {
    ElMessage.info("该关节坐标轴已对齐全局 Z-up 右手系");
    return;
  }

  const isZeroed = target.origin.rpy.every((v) => Math.abs(v) < 1e-9);
  ElMessage.success(
    isZeroed
      ? "坐标轴已对齐全局 Z-up 右手系，旋转轴以向量表达"
      : "坐标轴已对齐全局 Z-up 右手系；rpy 非零是因为父连杆坐标系尚未对齐，可用左侧「全部关节坐标轴对齐 Z-up」一次归零",
  );
}
</script>

<style lang="scss" scoped>
.joint-properties {
  padding: 4px 0;
}

.joint-path {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #f4f6f9;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 11px;
  flex-wrap: wrap;

  .path-link {
    color: var(--accent);
    font-weight: 500;
  }

  .path-joint {
    color: #e6a23c;
    font-weight: 500;
  }

  .el-icon {
    color: var(--text-3);
    font-size: 10px;
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

  .prop-label {
    font-size: 11px;
    color: #606266;
    width: 36px;
    flex-shrink: 0;
  }

  .prop-unit {
    font-size: 11px;
    color: var(--text-2);
    flex-shrink: 0;
    min-width: 36px;
  }

  .el-input,
  .el-select {
    flex: 1;
  }
}

.pick-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.flip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.flip-label {
  font-size: 11px;
  color: var(--text-2);
  flex-shrink: 0;
}

.coord-row {
  display: flex;
  align-items: center;
  gap: 3px;

  .coord-label {
    font-size: 11px;
    color: var(--text-2);
    width: 24px;
    flex-shrink: 0;
  }
}

.offset-hint {
  font-size: 11px;
  color: var(--text-2);
  margin: 0 0 6px;
  line-height: 1.4;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-2);
  padding: 16px 0;
  text-align: center;
}
</style>
