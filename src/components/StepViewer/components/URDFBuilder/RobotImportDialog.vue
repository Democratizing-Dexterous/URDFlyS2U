<template>
  <el-dialog
    :model-value="visible"
    title="导入 URDF / MJCF 结构"
    width="680px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => !v && emit('close')"
  >
    <el-alert
      title="导入 <robot>（URDF）或 <mujoco>（MJCF）文件重建连杆-关节树。URDF 中出现的第二个父连杆会自动转成闭链约束；MJCF 的 <equality> connect/weld 会直接读入闭链列表。"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-upload
      ref="uploadRef"
      drag
      :auto-upload="false"
      :show-file-list="false"
      :multiple="false"
      accept=".urdf,.xml,.mjcf"
      :on-change="handleFileChange"
    >
      <div class="robot-upload-placeholder">
        <el-icon class="robot-upload-icon">
          <UploadFilled />
        </el-icon>
        <p class="robot-upload-title">拖入 .urdf / .xml / .mjcf 文件</p>
        <p class="robot-upload-sub">或点击选择本地文件</p>
      </div>
    </el-upload>

    <div class="robot-option-row">
      <span class="robot-option-label">源文件长度单位</span>
      <el-select v-model="unit" size="small" style="width: 120px" @change="reparse">
        <el-option label="米 m（URDF 标准）" value="m" />
        <el-option label="毫米 mm" value="mm" />
        <el-option label="厘米 cm" value="cm" />
        <el-option label="英寸 inch" value="inch" />
      </el-select>
    </div>

    <div class="robot-option-row" v-if="stepStore.hasModel">
      <span class="robot-option-label">按名称把当前 Solid 自动绑定到新连杆</span>
      <el-switch v-model="autoBind" />
    </div>

    <div v-if="report" class="robot-report">
      <div class="robot-report-head">
        <el-tag size="small" type="primary">{{ report.format.toUpperCase() }}</el-tag>
        <span class="robot-report-name">{{ report.robot.name }}</span>
      </div>
      <div class="robot-report-stats">
        <span>连杆 {{ report.robot.links.length }}</span>
        <span>关节 {{ report.robot.joints.length }}</span>
        <span>闭链 {{ report.robot.loops.length }}</span>
        <span>可动关节 {{ movableCount }}</span>
      </div>
      <div v-if="report.warnings.length" class="robot-report-warnings">
        <div class="robot-warning-title">提示（{{ report.warnings.length }}）</div>
        <div v-for="(w, i) in report.warnings" :key="i" class="robot-warning-item">{{ w }}</div>
      </div>
    </div>

    <div v-if="parseError" class="robot-error">{{ parseError }}</div>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!report" @click="applyImport">应用结构</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, toRaw } from "vue";
import { ElMessage } from "element-plus";
import UploadFilled from "~icons/ep/upload-filled";
import type { UploadFile, UploadInstance } from "element-plus";
import {
  parseRobotText,
  ensureBaseLink,
  ROBOT_UNIT_SCALES,
  type RobotImportReport,
} from "../../core/RobotImport";
import { sumImportedMass } from "../../core/InertiaModel";
import { useURDFStore } from "../../stores/useURDFStore";
import { useStepViewerStore } from "../../stores/useStepViewerStore";

defineProps<{ visible: boolean }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "imported"): void;
}>();

const urdfStore = useURDFStore();
const stepStore = useStepViewerStore();

const uploadRef = ref<UploadInstance>();
const unit = ref<keyof typeof ROBOT_UNIT_SCALES>("m");
const autoBind = ref(true);
const fileText = ref("");
const fileName = ref("");
const report = ref<RobotImportReport | null>(null);
const parseError = ref("");

const movableCount = computed(
  () => report.value?.robot.joints.filter((j) => j.type !== "fixed").length ?? 0,
);

function parseCurrent(): void {
  parseError.value = "";
  report.value = null;
  if (!fileText.value) return;
  try {
    report.value = parseRobotText(fileText.value, { unitScale: ROBOT_UNIT_SCALES[unit.value] });
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : String(error);
  }
}

function reparse(): void {
  parseCurrent();
}

async function handleFileChange(uploadFile: UploadFile): Promise<void> {
  const raw = uploadFile.raw;
  if (!raw) return;
  const name = raw.name.toLowerCase();
  if (!/\.(urdf|xml|mjcf)$/.test(name)) {
    ElMessage.warning("仅支持 .urdf / .xml / .mjcf 文件");
    uploadRef.value?.clearFiles();
    return;
  }
  fileName.value = raw.name;
  fileText.value = await raw.text();
  if (name.endsWith(".xml") && /<\s*mujoco[\s>]/i.test(fileText.value)) unit.value = "m";
  parseCurrent();
}

function applyImport(): void {
  if (!report.value) return;

  const robot = structuredClone(toRaw(report.value.robot));
  ensureBaseLink(robot);
  urdfStore.importRobot(robot);

  const imported = sumImportedMass(robot.links);
  if (imported > 0) urdfStore.totalMass = imported;

  let boundInfo = "";
  if (autoBind.value && stepStore.hasModel) {
    const result = urdfStore.bindSolidsByName(
      stepStore.solids.map((s) => ({ id: s.id, name: s.name })),
    );
    boundInfo = `，已按名称绑定 ${result.bound} 个 Solid`;
    if (result.unmatchedSolids.length > 0) {
      boundInfo += `（${result.unmatchedSolids.length} 个未匹配）`;
    }
  }

  ElMessage.success(
    `已导入 ${report.value.robot.links.length} 个连杆 / ${report.value.robot.joints.length} 个关节` +
      `${report.value.robot.loops.length > 0 ? ` / ${report.value.robot.loops.length} 条闭链` : ""}${boundInfo}`,
  );

  emit("imported");
  emit("close");
  fileText.value = "";
  report.value = null;
  uploadRef.value?.clearFiles();
}
</script>

<style scoped lang="scss">
.robot-upload-placeholder {
  padding: 22px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  .robot-upload-icon {
    font-size: 28px;
    color: var(--accent);
  }

  .robot-upload-title {
    margin: 4px 0 0;
    font-size: 14px;
    font-weight: 600;
    color: #1d2129;
  }

  .robot-upload-sub {
    margin: 0;
    font-size: 12px;
    color: #86909c;
  }
}

.robot-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 2px 0;

  .robot-option-label {
    font-size: 12px;
    color: #606266;
  }
}

.robot-report {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;

  .robot-report-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .robot-report-name {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }

  .robot-report-stats {
    display: flex;
    gap: 14px;
    margin-top: 8px;
    font-size: 12px;
    color: #606266;
    font-family: monospace;
  }

  .robot-report-warnings {
    margin-top: 8px;
    max-height: 160px;
    overflow-y: auto;
  }

  .robot-warning-title {
    font-size: 11px;
    font-weight: 600;
    color: #e6a23c;
    margin-bottom: 3px;
  }

  .robot-warning-item {
    font-size: 11px;
    line-height: 1.6;
    color: #909399;
  }
}

.robot-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
}
</style>
