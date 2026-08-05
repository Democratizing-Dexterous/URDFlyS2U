<template>
  <div class="loops-module">
    <div class="module-header">
      <span class="module-title">🔗 闭链约束 (MuJoCo equality)</span>
      <el-button
        size="small"
        type="primary"
        text
        :disabled="urdfStore.robot.links.length < 2"
        @click="handleAdd"
      >
        + 添加
      </el-button>
    </div>

    <div v-if="urdfStore.robot.loops.length === 0" class="empty-hint">
      暂无闭链约束。URDF 为树结构无法表达闭链，此处定义的约束会写入 MuJoCo robot.xml 的
      &lt;equality&gt; 段。
    </div>

    <div v-for="loop in urdfStore.robot.loops" :key="loop.id" class="loop-item">
      <div class="loop-row">
        <el-input v-model="loop.name" size="small" style="width: 96px" />
        <el-select v-model="loop.type" size="small" style="width: 92px">
          <el-option label="Connect" value="connect" />
          <el-option label="Weld" value="weld" />
        </el-select>
        <el-switch v-model="loop.enabled" size="small" />
        <el-button
          size="small"
          type="danger"
          text
          :icon="Delete"
          @click="urdfStore.removeLoop(loop.id)"
        />
      </div>

      <div class="loop-row">
        <el-select v-model="loop.linkAId" size="small" style="width: 110px" placeholder="Link A">
          <el-option v-for="l in urdfStore.robot.links" :key="l.id" :label="l.name" :value="l.id" />
        </el-select>
        <span class="loop-arrow">↔</span>
        <el-select v-model="loop.linkBId" size="small" style="width: 110px" placeholder="Link B">
          <el-option v-for="l in urdfStore.robot.links" :key="l.id" :label="l.name" :value="l.id" />
        </el-select>
      </div>

      <div v-if="loop.type === 'connect'" class="loop-row">
        <span class="loop-label">锚点</span>
        <el-input-number
          v-model="loop.anchor[0]"
          size="small"
          :step="1"
          :precision="3"
          controls-position="right"
          style="width: 76px"
        />
        <el-input-number
          v-model="loop.anchor[1]"
          size="small"
          :step="1"
          :precision="3"
          controls-position="right"
          style="width: 76px"
        />
        <el-input-number
          v-model="loop.anchor[2]"
          size="small"
          :step="1"
          :precision="3"
          controls-position="right"
          style="width: 76px"
        />
      </div>

      <div v-if="loop.type === 'connect'" class="loop-row">
        <el-button size="small" text type="primary" @click="pickAnchorFromSelection(loop.id)">
          取当前选中点
        </el-button>
        <span class="loop-tip">世界坐标 mm，导出时自动转到 Link A 局部系</span>
      </div>

      <div class="loop-row">
        <span class="loop-label">solref</span>
        <el-input-number
          v-model="loop.solref[0]"
          size="small"
          :step="0.005"
          :precision="4"
          controls-position="right"
          style="width: 92px"
        />
        <el-input-number
          v-model="loop.solref[1]"
          size="small"
          :step="0.1"
          :precision="3"
          controls-position="right"
          style="width: 92px"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Delete from "~icons/ep/delete";
import { ElMessage } from "element-plus";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";

const urdfStore = useURDFStore();
const store = useStepViewerStore();

function handleAdd(): void {
  const links = urdfStore.robot.links;
  const leaves = urdfStore.leafLinks;
  const a = leaves[0]?.id ?? links[0].id;
  const b = leaves[1]?.id ?? links.find((l) => l.id !== a)?.id;
  if (!b) {
    ElMessage.warning("至少需要两个连杆");
    return;
  }
  const res = urdfStore.addLoop({ type: "connect", linkAId: a, linkBId: b });
  if (!res.ok) ElMessage.warning(res.reason);
}

function pickAnchorFromSelection(loopId: string): void {
  const features = store.selectedFeatures;
  const feature = features[features.length - 1];
  const point = feature?.center ?? feature?.startPoint;
  if (!point) {
    ElMessage.warning("请先在模型上选中一个圆心/点特征");
    return;
  }
  urdfStore.updateLoop(loopId, { anchor: [point.x, point.y, point.z] });
  ElMessage.success("已取选中点作为锚点");
}
</script>

<style lang="scss" scoped>
.loops-module {
  padding: 6px 4px;
}

.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.module-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.empty-hint {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.6;
  padding: 4px 2px;
}

.loop-item {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px;
  margin-bottom: 6px;
  background: var(--surface-2);
}

.loop-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.loop-label {
  font-size: 11px;
  color: #606266;
  width: 34px;
  flex-shrink: 0;
}

.loop-arrow {
  font-size: 12px;
  color: var(--text-2);
}

.loop-tip {
  font-size: 10px;
  color: var(--text-3);
}
</style>
