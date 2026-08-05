<template>
  <div class="collision-module">
    <div class="cm-actions">
      <el-button type="primary" size="small" :loading="busy" @click="handleGenerate">
        生成碰撞体
      </el-button>
      <el-button size="small" :disabled="!hasShapes" @click="handleClear">清除</el-button>
    </div>

    <div class="cm-form">
      <div class="cm-row">
        <span class="cm-label">形状</span>
        <el-select v-model="urdfStore.collisionConfig.mode" size="small" class="cm-control">
          <el-option
            v-for="opt in COLLISION_SHAPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>

      <div class="cm-row">
        <span class="cm-label">间隙 (mm)</span>
        <el-input-number
          v-model="urdfStore.collisionConfig.margin"
          size="small"
          class="cm-control"
          :min="0"
          :max="50"
          :step="0.1"
          :precision="2"
          controls-position="right"
        />
      </div>

      <div class="cm-row">
        <span class="cm-label">最小保留</span>
        <el-slider
          v-model="minScalePercent"
          size="small"
          class="cm-control"
          :min="10"
          :max="100"
          :step="5"
          :format-tooltip="(v: number) => v + '%'"
        />
      </div>

      <div class="cm-row">
        <span class="cm-label">关节扫掠</span>
        <div class="cm-control cm-inline">
          <el-switch v-model="urdfStore.collisionConfig.sweepCheck" size="small" />
          <el-input-number
            v-model="urdfStore.collisionConfig.sweepSamples"
            size="small"
            :disabled="!urdfStore.collisionConfig.sweepCheck"
            :min="2"
            :max="12"
            :step="1"
            controls-position="right"
            style="width: 92px"
          />
        </div>
      </div>

      <div class="cm-row">
        <span class="cm-label">场景显示</span>
        <div class="cm-control cm-inline">
          <el-switch v-model="urdfStore.collisionConfig.visible" size="small" />
          <span class="cm-hint">导出使用</span>
          <el-switch v-model="urdfStore.collisionConfig.useForExport" size="small" />
        </div>
      </div>
    </div>

    <el-alert
      v-if="conflictText"
      :title="conflictText"
      type="warning"
      size="small"
      :closable="false"
      show-icon
      class="cm-alert"
    />

    <div v-if="!hasShapes" class="cm-empty">尚未生成碰撞体，导出时将直接使用完整网格</div>

    <div v-else class="cm-list">
      <div v-for="row in rows" :key="row.linkId" class="cm-item">
        <div class="cm-item-head">
          <span class="cm-name" :title="row.name">{{ row.name }}</span>
          <el-tag v-if="row.shrunk" size="small" type="warning" class="cm-tag">已收缩</el-tag>
          <span class="cm-ratio" :class="{ loose: row.ratio > 2 }">{{ row.ratioText }}</span>
        </div>
        <el-select
          :model-value="row.mode"
          size="small"
          class="cm-item-select"
          @change="(v: CollisionMode) => handleModeChange(row.linkId, v)"
        >
          <el-option
            v-for="opt in COLLISION_SHAPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { ElMessage } from "element-plus";
import { useURDFStore } from "../../stores/useURDFStore";
import { COLLISION_SHAPE_OPTIONS } from "../../types";
import type { CollisionMode } from "../../types";

const urdfStore = useURDFStore();
const busy = ref(false);

const hasShapes = computed(() => urdfStore.collisionShapes.length > 0);

const minScalePercent = computed({
  get: () => Math.round(urdfStore.collisionConfig.minScale * 100),
  set: (v: number) => {
    urdfStore.collisionConfig.minScale = v / 100;
  },
});

const typeLabel: Record<string, string> = {
  box: "Box",
  cylinder: "Cylinder",
  sphere: "Sphere",
};

const rows = computed(() =>
  urdfStore.collisionShapes.map((shape) => {
    const ratio = shape.meshVolume > 0 ? shape.shapeVolume / shape.meshVolume : 0;
    return {
      linkId: shape.linkId,
      name: `${urdfStore.linkMap.get(shape.linkId)?.name ?? shape.linkId} · ${typeLabel[shape.type]}`,
      shrunk: shape.shrunk,
      ratio,
      ratioText: ratio > 0 ? `${ratio.toFixed(2)}×` : "—",
      mode: urdfStore.collisionOverrides[shape.linkId] || "auto",
    };
  }),
);

const conflictText = computed(() => {
  const list = urdfStore.collisionConflicts;
  if (list.length === 0) return "";
  const names = list.slice(0, 3).map((c) => {
    const a = urdfStore.linkMap.get(c.linkAId)?.name ?? c.linkAId;
    const b = urdfStore.linkMap.get(c.linkBId)?.name ?? c.linkBId;
    return `${a}↔${b}`;
  });
  return `${list.length} 处干涉受最小保留比例限制未能完全分离：${names.join("，")}`;
});

async function runGenerate(silent = false): Promise<void> {
  busy.value = true;
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 16));
  try {
    const result = urdfStore.generateCollisionShapes();
    if (result.count === 0) {
      ElMessage.warning("没有可用的连杆几何，请先为 Link 绑定 Solid");
    } else if (!silent) {
      ElMessage.success(`已生成 ${result.count} 个碰撞体`);
    }
  } catch (err) {
    ElMessage.error(`碰撞体生成失败: ${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

function handleGenerate(): void {
  void runGenerate();
}

function handleClear(): void {
  urdfStore.clearCollisionShapes();
}

function handleModeChange(linkId: string, mode: CollisionMode): void {
  urdfStore.setLinkCollisionMode(linkId, mode);
  void runGenerate(true);
}
</script>

<style lang="scss" scoped>
.collision-module {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cm-actions {
  display: flex;
  gap: 6px;

  .el-button {
    flex: 1;
  }
}

.cm-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cm-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cm-label {
  width: 62px;
  flex-shrink: 0;
  font-size: 12px;
  color: #606266;
}

.cm-control {
  flex: 1;
  min-width: 0;
}

.cm-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cm-hint {
  font-size: 11px;
  color: var(--text-2);
}

.cm-alert {
  padding: 4px 8px;

  :deep(.el-alert__title) {
    font-size: 11px;
    line-height: 1.4;
  }
}

.cm-empty {
  font-size: 11px;
  color: var(--text-2);
  text-align: center;
  padding: 8px 0;
}

.cm-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cm-item {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cm-item-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cm-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cm-tag {
  flex-shrink: 0;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  font-size: 10px;
}

.cm-ratio {
  flex-shrink: 0;
  font-size: 11px;
  color: #67c23a;

  &.loose {
    color: #e6a23c;
  }
}

.cm-item-select {
  width: 100%;
}
</style>
