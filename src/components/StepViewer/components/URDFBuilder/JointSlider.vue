<template>
  <div v-if="joint.type === 'ball'" class="ball-group">
    <span class="slider-name ball-title" :title="joint.name">{{ joint.name }} (ball)</span>
    <div v-for="(label, i) in BALL_LABELS" :key="label" class="joint-slider">
      <span class="slider-name ball-axis">{{ label }}</span>
      <el-slider
        :model-value="ballValue[i]"
        :min="-ballRange"
        :max="ballRange"
        :step="ballStep"
        :show-tooltip="false"
        @update:model-value="(v: any) => handleBallChange(i, v)"
      />
      <span class="slider-value">{{ ballValue[i].toFixed(3) }}</span>
    </div>
  </div>

  <div v-else-if="joint.type === 'floating'" class="joint-slider">
    <span class="slider-name" :title="joint.name">{{ joint.name }}</span>
    <span class="slider-hint">自由关节（6 自由度，由仿真器驱动）</span>
  </div>

  <div v-else class="joint-slider">
    <span class="slider-name" :title="joint.name">{{ joint.name }}</span>
    <el-slider
      :model-value="joint.currentValue"
      :min="joint.limits.lower"
      :max="joint.limits.upper"
      :step="sliderStep"
      :show-tooltip="false"
      @update:model-value="handleChange"
    />
    <span class="slider-value">{{ joint.currentValue.toFixed(3) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useURDFStore } from "../../stores/useURDFStore";
import type { URDFJoint } from "../../types";

const props = defineProps<{
  joint: URDFJoint;
}>();

const urdfStore = useURDFStore();

const BALL_LABELS = ["R", "P", "Y"];

const ballValue = computed(() => props.joint.ballValue || [0, 0, 0]);

const ballRange = computed(() =>
  Math.max(Math.abs(props.joint.limits.lower), Math.abs(props.joint.limits.upper), 0.01),
);

const ballStep = computed(() => (ballRange.value * 2) / 200);

function handleBallChange(index: number, val: number | number[]): void {
  const v = Array.isArray(val) ? val[0] : val;
  const next = [...ballValue.value] as [number, number, number];
  next[index] = v;
  urdfStore.setBallValue(props.joint.id, next);
}

const sliderStep = computed(() => {
  const range = props.joint.limits.upper - props.joint.limits.lower;
  return range > 0 ? range / 200 : 0.01;
});

function handleChange(val: number | number[]): void {
  const v = Array.isArray(val) ? val[0] : val;
  urdfStore.setJointValue(props.joint.id, v);
}
</script>

<style lang="scss" scoped>
.ball-group {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 4px 0;
}

.ball-title {
  font-weight: 600;
}

.ball-axis {
  width: 16px;
  color: var(--text-2);
}

.slider-hint {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
}

.joint-slider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
  width: 100%;
}

.slider-name {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slider-value {
  flex-shrink: 0;
  text-align: right;
  font-size: 14px;
  color: var(--text-1);
  font-family: monospace;
  font-weight: 600;
  letter-spacing: -0.3px;
}
</style>
