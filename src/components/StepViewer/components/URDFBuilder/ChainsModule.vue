<template>
  <div class="chains-module">
    <div class="module-header">
      <span class="module-title">🔗 Chains</span>
    </div>

    <el-select
      v-model="urdfStore.selectedChainId"
      placeholder="Select Chain"
      size="small"
      clearable
      style="width: 100%"
    >
      <el-option
        v-for="chain in urdfStore.chains"
        :key="chain.id"
        :label="chain.name"
        :value="chain.id"
      />
    </el-select>

    <div v-if="urdfStore.chains.length === 0" class="empty-hint">
      添加 Link 和 Joint 后自动生成运动链
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useURDFStore } from '../../stores/useURDFStore'

const urdfStore = useURDFStore()

const emit = defineEmits<{
  (e: 'chainChanged', chainId: string | null): void
}>()

watch(() => urdfStore.selectedChainId, (newId) => {
  emit('chainChanged', newId)
})
</script>

<style lang="scss" scoped>
.chains-module {
  .module-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .module-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }

  .empty-hint {
    font-size: 11px;
    color: #909399;
    padding: 4px 0;
  }
}
</style>
