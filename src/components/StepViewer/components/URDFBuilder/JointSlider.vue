<template>
  <div class="joint-slider">
    <span class="slider-name" :title="joint.name">{{ joint.name }}</span>
    <el-slider :model-value="joint.currentValue" :min="joint.limits.lower" :max="joint.limits.upper" :step="sliderStep"
      :show-tooltip="false" @update:model-value="handleChange" />
    <span class="slider-value">{{ joint.currentValue.toFixed(3) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useURDFStore } from '../../stores/useURDFStore'
import type { URDFJoint } from '../../types'

const props = defineProps<{
  joint: URDFJoint
}>()

const urdfStore = useURDFStore()

const sliderStep = computed(() => {
  const range = props.joint.limits.upper - props.joint.limits.lower
  return range > 0 ? range / 200 : 0.01
})

function handleChange(val: number | number[]): void {
  const v = Array.isArray(val) ? val[0] : val
  urdfStore.setJointValue(props.joint.id, v)
}
</script>

<style lang="scss" scoped>
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
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


.slider-value {
  flex-shrink: 0;
  text-align: right;
  font-size: 14px;
  color: #606266;
  font-family: monospace;
  letter-spacing: -0.3px;
}
</style>
