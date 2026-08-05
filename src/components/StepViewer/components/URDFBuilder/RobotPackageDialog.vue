<template>
  <el-dialog
    :model-value="visible"
    title="导入机器人包（描述文件 + meshes）"
    width="760px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => !v && emit('close')"
  >
    <el-alert
      title="把整个机器人文件夹拖进来，自动扫描其中的 .urdf / .xml(MJCF) 与 meshes 网格；选择要加载的描述文件后，按连杆装配并可视化。"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <div
      class="pkg-drop"
      :class="{ 'is-dragover': dragover, 'is-busy': scanning }"
      @dragover.prevent="dragover = true"
      @dragleave.prevent="dragover = false"
      @drop.prevent="handleDrop"
      @click="pickDirectory"
    >
      <el-icon class="pkg-drop-icon"><FolderOpened /></el-icon>
      <p class="pkg-drop-title">
        {{ scanning ? "正在扫描文件夹..." : "把机器人文件夹拖到此处" }}
      </p>
      <p class="pkg-drop-sub">或点击选择本地文件夹（也可多选描述文件与网格文件）</p>
      <input
        ref="dirInputRef"
        type="file"
        multiple
        webkitdirectory
        class="pkg-hidden-input"
        @change="handleInputChange"
      />
    </div>

    <div v-if="packageFiles.length > 0" class="pkg-summary">
      <el-tag size="small" type="primary">描述文件 {{ descriptors.length }}</el-tag>
      <el-tag size="small" type="success">网格 {{ meshIndex.size }}</el-tag>
      <el-tag size="small" type="info">扫描文件 {{ packageFiles.length }}</el-tag>
      <span v-if="rootName" class="pkg-root-name">{{ rootName }}</span>
    </div>
    <div v-if="descriptors.length > 0" class="pkg-section">
      <div class="pkg-section-title">选择要加载的描述文件</div>
      <el-radio-group v-model="selectedPath" class="pkg-desc-list">
        <label
          v-for="item in descriptors"
          :key="item.path"
          class="pkg-desc-item"
          :class="{ 'is-active': selectedPath === item.path }"
        >
          <el-radio :value="item.path" class="pkg-desc-radio">
            <div class="pkg-desc-main">
              <div class="pkg-desc-head">
                <el-tag size="small" :type="item.format === 'urdf' ? 'primary' : 'warning'">
                  {{ item.format.toUpperCase() }}
                </el-tag>
                <span class="pkg-desc-name">{{ item.name }}</span>
                <span class="pkg-desc-robot">{{ item.robotName }}</span>
              </div>
              <div class="pkg-desc-meta">
                <span>路径 {{ item.path }}</span>
                <span>连杆 {{ item.linkCount }}</span>
                <span>网格引用 {{ item.meshRefCount }}</span>
                <span>{{ formatBytes(item.size) }}</span>
              </div>
            </div>
          </el-radio>
        </label>
      </el-radio-group>
    </div>

    <div v-if="selected" class="pkg-section">
      <div class="pkg-option-row">
        <span class="pkg-option-label">源文件长度单位</span>
        <el-select v-model="unit" size="small" style="width: 150px">
          <el-option label="米 m（URDF 标准）" value="m" />
          <el-option label="毫米 mm" value="mm" />
          <el-option label="厘米 cm" value="cm" />
          <el-option label="英寸 inch" value="inch" />
        </el-select>
      </div>
      <div class="pkg-option-row">
        <span class="pkg-option-label">加载的网格类型</span>
        <el-radio-group v-model="meshKind" size="small">
          <el-radio-button value="visual">visual</el-radio-button>
          <el-radio-button value="collision">collision</el-radio-button>
        </el-radio-group>
      </div>
      <div class="pkg-option-row">
        <span class="pkg-option-label">按 visual 原点预变换网格（推荐）</span>
        <el-switch v-model="applyOrigin" />
      </div>
    </div>
    <div v-if="preview" class="pkg-report">
      <div class="pkg-report-stats">
        <span>连杆 {{ preview.links }}</span>
        <span>关节 {{ preview.joints }}</span>
        <span>闭链 {{ preview.loops }}</span>
        <span>可动关节 {{ preview.movable }}</span>
        <span>待加载网格 {{ preview.meshes }}</span>
      </div>
      <div v-if="preview.missing.length" class="pkg-report-warn">
        缺失网格 {{ preview.missing.length }} 个：{{ preview.missing.slice(0, 4).join("、") }}
        <span v-if="preview.missing.length > 4">…</span>
      </div>
      <div v-if="preview.warnings.length" class="pkg-report-warn">
        <div v-for="(w, i) in preview.warnings.slice(0, 6)" :key="i">{{ w }}</div>
      </div>
    </div>

    <div v-if="loading" class="pkg-progress">
      <el-progress :percentage="progressPercent" :stroke-width="12" />
      <span class="pkg-progress-text">{{ progressText }}</span>
    </div>

    <div v-if="errorText" class="pkg-error">{{ errorText }}</div>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="!selected" @click="applyPackage">
        加载并可视化
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import FolderOpened from "~icons/ep/folder-opened";
import { collectFilesFromDataTransfer, collectFilesFromInput } from "../../core/DirectoryDrop";
import {
  buildMeshIndex,
  collectDescriptors,
  resolveLinkMeshes,
  type DescriptorCandidate,
  type PackageFile,
} from "../../core/RobotPackage";
import { loadRobotPackageGeometry } from "../../core/RobotPackageLoader";
import { parseRobotText, ensureBaseLink, ROBOT_UNIT_SCALES } from "../../core/RobotImport";
import { formatBytes } from "../../utils/format";
import type { RobotPackagePayload } from "../../types";

defineProps<{ visible: boolean }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "loaded", payload: RobotPackagePayload): void;
}>();

const dirInputRef = ref<HTMLInputElement>();
const dragover = ref(false);
const scanning = ref(false);
const loading = ref(false);
const errorText = ref("");
const progressPercent = ref(0);
const progressText = ref("");

const packageFiles = ref<PackageFile[]>([]);
const descriptors = ref<DescriptorCandidate[]>([]);
const selectedPath = ref("");
const unit = ref<keyof typeof ROBOT_UNIT_SCALES>("m");
const meshKind = ref<"visual" | "collision">("visual");
const applyOrigin = ref(true);

const meshIndex = computed(() => buildMeshIndex(packageFiles.value));
const selected = computed(
  () => descriptors.value.find((d) => d.path === selectedPath.value) ?? null,
);
const rootName = computed(() => packageFiles.value[0]?.path.split("/")[0] ?? "");

interface PreviewInfo {
  links: number;
  joints: number;
  loops: number;
  movable: number;
  meshes: number;
  missing: string[];
  warnings: string[];
}

const preview = ref<PreviewInfo | null>(null);

function refreshPreview(): void {
  errorText.value = "";
  preview.value = null;
  const descriptor = selected.value;
  if (!descriptor) return;

  try {
    const parsed = parseRobotText(descriptor.text, {
      unitScale: ROBOT_UNIT_SCALES[unit.value],
    });
    const resolved = resolveLinkMeshes(descriptor, meshIndex.value, {
      visual: meshKind.value === "visual",
      collision: meshKind.value === "collision",
    });
    const meshes = resolved.bindings.reduce(
      (sum, b) => sum + b.refs.filter((r) => !!r.file).length,
      0,
    );
    preview.value = {
      links: parsed.robot.links.length,
      joints: parsed.robot.joints.length,
      loops: parsed.robot.loops.length,
      movable: parsed.robot.joints.filter((j) => j.type !== "fixed").length,
      meshes,
      missing: [...new Set(resolved.missing)],
      warnings: parsed.warnings,
    };
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error);
  }
}

watch([selectedPath, unit, meshKind], refreshPreview);

async function ingest(files: PackageFile[]): Promise<void> {
  if (files.length === 0) {
    ElMessage.warning("没有找到 .urdf / .xml 描述文件或网格文件");
    return;
  }

  scanning.value = true;
  errorText.value = "";
  try {
    packageFiles.value = files;
    descriptors.value = await collectDescriptors(files);
    if (descriptors.value.length === 0) {
      errorText.value = "包内没有可识别的 URDF / MJCF 描述文件";
      selectedPath.value = "";
      preview.value = null;
      return;
    }
    selectedPath.value = descriptors.value[0].path;
    refreshPreview();
  } finally {
    scanning.value = false;
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  dragover.value = false;
  if (!event.dataTransfer) return;
  scanning.value = true;
  try {
    const files = await collectFilesFromDataTransfer(event.dataTransfer);
    await ingest(files);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "读取拖入内容失败";
  } finally {
    scanning.value = false;
  }
}

function pickDirectory(): void {
  dirInputRef.value?.click();
}

async function handleInputChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  await ingest(collectFilesFromInput(input.files));
  input.value = "";
}

async function applyPackage(): Promise<void> {
  const descriptor = selected.value;
  if (!descriptor) return;

  loading.value = true;
  errorText.value = "";
  progressPercent.value = 0;
  progressText.value = "正在解析结构...";

  try {
    const unitScale = ROBOT_UNIT_SCALES[unit.value];
    const parsed = parseRobotText(descriptor.text, { unitScale });
    const robot = structuredClone(parsed.robot);
    ensureBaseLink(robot);

    const resolved = resolveLinkMeshes(descriptor, meshIndex.value, {
      visual: meshKind.value === "visual",
      collision: meshKind.value === "collision",
    });
    const bindings = applyOrigin.value
      ? resolved.bindings
      : resolved.bindings.map((b) => ({
          ...b,
          refs: b.refs.map((r) => ({
            ...r,
            origin: {
              xyz: [0, 0, 0] as [number, number, number],
              rpy: [0, 0, 0] as [number, number, number],
            },
          })),
        }));

    const geometry = await loadRobotPackageGeometry(bindings, unitScale, robot, (p) => {
      progressPercent.value = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
      progressText.value = p.current ? `正在加载 ${p.current}` : "网格加载完成";
    });

    emit("loaded", {
      robot,
      solids: geometry.solids,
      tree: geometry.tree,
      linkSolidNames: geometry.linkSolidNames,
      fileName: descriptor.name,
      triangles: geometry.triangles,
      warnings: [
        ...parsed.warnings,
        ...geometry.skipped,
        ...resolved.missing.map((m) => `缺失网格：${m}`),
      ],
    });
    emit("close");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
.pkg-drop {
  border: 1px dashed var(--el-border-color, #dcdfe6);
  border-radius: 10px;
  padding: 22px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;

  &.is-dragover {
    border-color: var(--el-color-primary, var(--accent));
    background: var(--el-color-primary-light-9, var(--el-color-primary-light-9));
  }

  &.is-busy {
    opacity: 0.7;
    cursor: progress;
  }
}

.pkg-drop-icon {
  font-size: 30px;
  color: var(--el-color-primary, var(--accent));
}

.pkg-drop-title {
  margin: 6px 0 2px;
  font-size: 14px;
  font-weight: 600;
}

.pkg-drop-sub {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #86909c);
}

.pkg-hidden-input {
  display: none;
}

.pkg-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.pkg-root-name {
  font-size: 12px;
  color: var(--el-text-color-secondary, #86909c);
}

.pkg-section {
  margin-top: 14px;
}

.pkg-section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.pkg-desc-list {
  display: block;
  max-height: 240px;
  overflow-y: auto;
  width: 100%;
}

.pkg-desc-item {
  display: block;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;

  &.is-active {
    border-color: var(--el-color-primary, var(--accent));
    background: var(--el-color-primary-light-9, var(--el-color-primary-light-9));
  }
}

.pkg-desc-radio {
  width: 100%;
  height: auto;

  :deep(.el-radio__label) {
    width: 100%;
  }
}

.pkg-desc-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pkg-desc-name {
  font-size: 13px;
  font-weight: 600;
}

.pkg-desc-robot {
  font-size: 12px;
  color: var(--el-text-color-secondary, #86909c);
}

.pkg-desc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  font-family: monospace;
  color: var(--el-text-color-secondary, #909399);
}

.pkg-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 2px;
}

.pkg-option-label {
  font-size: 12px;
  color: var(--el-text-color-regular, #606266);
}

.pkg-report {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
}

.pkg-report-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  font-family: monospace;
  color: var(--el-text-color-regular, #606266);
}

.pkg-report-warn {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--el-color-warning, #e6a23c);
}

.pkg-progress {
  margin-top: 12px;
}

.pkg-progress-text {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
}

.pkg-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-color-danger-light-9, #fef0f0);
  color: var(--el-color-danger, #f56c6c);
  font-size: 12px;
}
</style>
