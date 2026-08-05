<script setup lang="ts">
import { RouterView } from "vue-router";
import { ProgressProvider } from "@bprogress/vue";
import { PROGRESS_COLOR, PROGRESS_HEIGHT, progressOptions } from "@/config/progress";
</script>

<template>
  <ProgressProvider
    class="app-progress"
    :color="PROGRESS_COLOR"
    :height="PROGRESS_HEIGHT"
    :options="progressOptions"
  >
    <RouterView />
  </ProgressProvider>
</template>

<style lang="scss" scoped>
.app-progress {
  width: 100%;
  height: 100%;
}
</style>
