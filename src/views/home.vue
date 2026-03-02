<template>
  <div class="home">
    <StepViewer ref="viewerRef" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { StepViewer } from '@/components/StepViewer'

const viewerRef = ref<InstanceType<typeof StepViewer>>()
</script>

<style lang="scss" scoped>
.home {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
