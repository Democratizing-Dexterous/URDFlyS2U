<template>
  <div class="step-viewer-toolbar">
    <div class="toolbar-left">
      <div class="toolbar-section">
        <el-button
          v-hint="
            occtReady
              ? '选择并导入 STEP / STP / STL 模型文件'
              : 'OpenCASCADE 引擎加载中，STL 可直接导入'
          "
          class="primary-action"
          type="primary"
          size="small"
          :loading="isLoading"
          :icon="UploadFilled"
          :disabled="isLoading"
          @click="openUploadDialog"
        >
          {{ isLoading ? "加载中..." : "导入模型" }}
        </el-button>
        <div class="tb-group">
          <el-button
            v-hint="'导入 URDF / MJCF(xml)，重建连杆-关节树与闭链约束，可随后替换 STEP 几何'"
            size="small"
            text
            :icon="Share"
            @click="$emit('importRobot')"
          >
            导入结构
          </el-button>
          <el-button
            v-hint="'拖入整个机器人文件夹（URDF/MJCF + meshes），选择描述文件后直接装配并可视化'"
            size="small"
            text
            :icon="FolderAdd"
            @click="$emit('importRobotPackage')"
          >
            导入机器人包
          </el-button>
        </div>
        <div v-if="!occtReady" class="wasm-progress">
          <el-progress
            :percentage="Math.round(occtLoadProgress ?? 0)"
            :stroke-width="14"
            :show-text="false"
          />
          <span class="wasm-progress-text"
            >OpenCASCADE WASM 加载中 ({{ Math.round(occtLoadProgress ?? 0) }}%)</span
          >
        </div>
        <div class="tb-group">
          <el-button
            v-hint="'打开已保存的项目，或导入 .miles 项目文件'"
            size="small"
            text
            :icon="FolderOpened"
            @click="$emit('openProjects')"
          >
            项目
          </el-button>
          <el-button
            v-if="hasModel"
            v-hint="autosaveHint || '把当前会话保存为项目'"
            size="small"
            text
            :icon="Select"
            :loading="projectSaving"
            @click="$emit('saveProject')"
          >
            {{ projectSaving ? "保存中" : "保存项目" }}
          </el-button>
        </div>
        <span v-if="fileName" class="file-name" :title="fileName">{{ fileName }}</span>
      </div>

      <el-dialog
        v-model="uploadDialogVisible"
        width="520px"
        :close-on-click-modal="false"
        :append-to-body="true"
        class="step-upload-dialog"
        align-center
        title="导入模型文件"
      >
        <div class="upload-dialog-body">
          <el-upload
            ref="elUploadRef"
            class="step-uploader"
            drag
            :auto-upload="false"
            :show-file-list="false"
            :multiple="false"
            accept=".step,.stp,.stl"
            :on-change="handleElUploadChange"
          >
            <div class="upload-placeholder">
              <div class="uph-icon-wrap">
                <el-icon class="uph-icon">
                  <UploadFilled />
                </el-icon>
              </div>
              <p class="uph-title">将文件拖到此处</p>
              <p class="uph-sub">或 <em class="uph-browse">点击选择本地文件</em></p>
              <div class="uph-tags">
                <el-tag size="small" type="primary" effect="light" round>.STEP</el-tag>
                <el-tag size="small" type="primary" effect="light" round>.STP</el-tag>
                <el-tag size="small" type="success" effect="light" round>.STL</el-tag>
                <span class="uph-size-note">最大上传限制300MB</span>
              </div>
            </div>
          </el-upload>

          <transition name="file-card-slide">
            <div v-if="pendingFile" class="selected-file-card">
              <div class="sfc-icon-block">
                <el-icon class="sfc-doc-icon">
                  <Document />
                </el-icon>
                <span class="sfc-ext">{{ fileExtension }}</span>
              </div>
              <div class="sfc-meta">
                <div class="sfc-name" :title="pendingFile.name">{{ pendingFile.name }}</div>
                <div class="sfc-detail">
                  <span class="sfc-size">{{ formatBytes(pendingFile.size) }}</span>
                  <el-divider direction="vertical" />
                  <el-icon class="sfc-check">
                    <CircleCheckFilled />
                  </el-icon>
                  <span class="sfc-ready">准备就绪</span>
                </div>
              </div>
              <el-tooltip content="移除文件" placement="top" :show-after="600">
                <el-button
                  class="sfc-remove"
                  :icon="Close"
                  circle
                  plain
                  size="small"
                  @click.stop="removePendingFile"
                />
              </el-tooltip>
            </div>
          </transition>

          <div v-if="isStlPending" class="mesh-options">
            <div class="mesh-options-title">STL 网格选项</div>
            <div class="mesh-option-row">
              <span class="mesh-option-label">长度单位</span>
              <el-select v-model="meshUnit" size="small" style="width: 130px">
                <el-option label="自动识别" value="auto" />
                <el-option label="毫米 mm" value="mm" />
                <el-option label="厘米 cm" value="cm" />
                <el-option label="米 m" value="m" />
                <el-option label="英寸 inch" value="inch" />
              </el-select>
            </div>
            <div class="mesh-option-row">
              <span class="mesh-option-label">按连通面片拆解为多个 Solid</span>
              <el-switch v-model="meshSplit" />
            </div>
            <div class="mesh-option-row" v-if="meshSplit">
              <span class="mesh-option-label">分离仅贴合接触的零件（推荐）</span>
              <el-switch v-model="meshSeparateTouching" />
            </div>
            <div class="mesh-option-row" v-if="meshSplit">
              <span class="mesh-option-label">忽略小于 N 个三角面的碎片</span>
              <el-input-number
                v-model="meshMinTriangles"
                :min="0"
                :max="100000"
                :step="4"
                size="small"
                controls-position="right"
                style="width: 120px"
              />
            </div>
            <p class="mesh-option-hint">
              内部统一使用毫米；「自动识别」按包围盒判断，整体尺寸小于 10 时视为米并放大 1000
              倍。拆解基于半边拓扑：仅贴合接触（共面、共棱）的零件会被判为不同实体，不会把电机和结构件并成一个。
            </p>
          </div>

          <div v-if="canKeepStructure" class="mesh-options">
            <div class="mesh-option-row">
              <span class="mesh-option-label">保留当前 URDF 结构并按名称自动绑定</span>
              <el-switch v-model="keepStructure" />
            </div>
            <p class="mesh-option-hint">
              开启后只替换几何：连杆、关节、闭链与惯性设置全部保留，新几何会按名称自动重新绑定。
            </p>
          </div>
        </div>

        <template #footer>
          <el-button @click="uploadDialogVisible = false">取消</el-button>
          <el-button
            type="primary"
            :icon="UploadFilled"
            :disabled="!pendingFile"
            @click="confirmUpload"
          >
            开始导入
          </el-button>
        </template>
      </el-dialog>
    </div>
    <div class="toolbar-center" v-if="hasModel">
      <div class="tb-group">
        <el-button
          v-hint="'显示 / 隐藏世界坐标轴'"
          size="small"
          :type="showAxes ? 'primary' : 'default'"
          text
          @click="$emit('toggleAxes')"
        >
          轴
        </el-button>
        <el-button
          v-hint="'显示 / 隐藏地面网格'"
          size="small"
          :type="showGrid ? 'primary' : 'default'"
          text
          @click="$emit('toggleGrid')"
        >
          网格
        </el-button>
        <div class="opacity-control" v-hint="'调整模型整体不透明度，便于观察内部结构'">
          <span class="opacity-label">透明度</span>
          <el-slider
            v-model="localOpacity"
            :min="0"
            :max="100"
            :step="5"
            :show-tooltip="true"
            :format-tooltip="(val: any) => `${val}%`"
            @change="handleOpacityInput"
            style="width: 96px"
          />
        </div>
      </div>

      <div class="tb-group">
        <el-button
          v-hint="'在模型或空间中点击两点画直线，自动计算距离'"
          size="small"
          :type="isLineMeasureActive ? 'warning' : 'default'"
          text
          @click="$emit('toggleLineMeasure')"
        >
          画线测量
        </el-button>
        <el-button
          v-hint="'打开 / 关闭模型结构树面板'"
          size="small"
          :type="isModelTreeOpen ? 'primary' : 'default'"
          text
          @click="$emit('toggleModelTree')"
        >
          模型树
        </el-button>
      </div>
    </div>

    <div class="toolbar-right" v-if="hasModel">
      <div class="tb-group">
        <el-button
          v-hint="'清除当前的实体与特征选择'"
          size="small"
          :disabled="!hasSelection"
          text
          @click="$emit('clearSelection')"
        >
          取消选择
        </el-button>
        <el-tooltip content="适应窗口" placement="bottom" :show-after="600">
          <el-button
            v-hint="'缩放相机使整个模型充满视口'"
            size="small"
            text
            :icon="Aim"
            @click="$emit('fitView')"
          />
        </el-tooltip>
        <el-tooltip content="重置视图" placement="bottom" :show-after="600">
          <el-button
            v-hint="'恢复默认相机角度与缩放'"
            size="small"
            text
            :icon="RefreshRight"
            @click="$emit('resetView')"
          />
        </el-tooltip>
      </div>

      <div class="tb-group">
        <el-button
          v-hint="'显示 / 隐藏帧率与渲染统计面板'"
          size="small"
          :type="showStats ? 'warning' : 'default'"
          :icon="DataLine"
          text
          @click="$emit('toggleStats')"
        >
          FPS
        </el-button>
        <el-tooltip content="GitHub 仓库" placement="bottom" :show-after="600">
          <el-button
            v-hint="'在新标签页打开 step2urdf 的 GitHub 仓库'"
            class="github-btn"
            size="small"
            text
            @click="openGitHub"
          >
            <svg
              class="github-icon"
              viewBox="0 0 1024 1024"
              width="16"
              height="16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
                transform="scale(64)"
                fill="currentColor"
              />
            </svg>
          </el-button>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { vHint } from "./composables/useHintBar";
import { formatBytes } from "../utils/format";
import type { UploadFile, UploadInstance } from "element-plus";
import type { MeshUnit, ModelUploadOptions } from "../types";
import UploadFilled from "~icons/ep/upload-filled";
import Aim from "~icons/ep/aim";
import RefreshRight from "~icons/ep/refresh-right";
import DataLine from "~icons/ep/data-line";
import Document from "~icons/ep/document";
import Close from "~icons/ep/close";
import CircleCheckFilled from "~icons/ep/circle-check-filled";
import FolderOpened from "~icons/ep/folder-opened";
import Select from "~icons/ep/select";
import Share from "~icons/ep/share";
import FolderAdd from "~icons/ep/folder-add";

const props = defineProps<{
  fileName: string;
  isLoading: boolean;
  hasModel: boolean;
  hasRobotStructure?: boolean;
  hasSelection: boolean;
  showAxes: boolean;
  showGrid: boolean;
  showStats: boolean;
  occtReady: boolean;
  occtLoadProgress?: number;
  isLineMeasureActive?: boolean;
  isModelTreeOpen?: boolean;
  opacity?: number;
  projectSaving?: boolean;
  autosaveHint?: string;
}>();

const emit = defineEmits<{
  (e: "upload", file: File, options: ModelUploadOptions): void;
  (e: "importRobot"): void;
  (e: "importRobotPackage"): void;
  (e: "fitView"): void;
  (e: "toggleAxes"): void;
  (e: "toggleGrid"): void;
  (e: "opacityChange", value: number): void;
  (e: "clearSelection"): void;
  (e: "resetView"): void;
  (e: "toggleStats"): void;
  (e: "toggleLineMeasure"): void;
  (e: "toggleModelTree"): void;
  (e: "openProjects"): void;
  (e: "saveProject"): void;
}>();

const localOpacity = ref(props.opacity ?? 100);

const uploadDialogVisible = ref(false);
const pendingFile = ref<File | null>(null);
const elUploadRef = ref<UploadInstance>();

const meshUnit = ref<MeshUnit>("auto");
const meshSplit = ref(true);
const meshMinTriangles = ref(0);
const meshSeparateTouching = ref(true);
const keepStructure = ref(false);

const fileExtension = computed(() => {
  const name = pendingFile.value?.name.toLowerCase() ?? "";
  if (name.endsWith(".stl")) return "STL";
  if (name.endsWith(".step")) return "STEP";
  return "STP";
});

const isStlPending = computed(() => fileExtension.value === "STL");

const canKeepStructure = computed(() => !!props.hasRobotStructure && !!pendingFile.value);

function isValidModelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".step") || name.endsWith(".stp") || name.endsWith(".stl");
}

function openUploadDialog(): void {
  pendingFile.value = null;
  uploadDialogVisible.value = true;
  keepStructure.value = !!props.hasRobotStructure;
  setTimeout(() => elUploadRef.value?.clearFiles(), 80);
}

function handleElUploadChange(uploadFile: UploadFile): void {
  const raw = uploadFile.raw;
  if (!raw) return;
  if (!isValidModelFile(raw)) {
    ElMessage.warning("仅支持 .step / .stp / .stl 格式的文件");
    elUploadRef.value?.clearFiles();
    return;
  }
  pendingFile.value = raw;
}

function removePendingFile(): void {
  pendingFile.value = null;
  elUploadRef.value?.clearFiles();
}

function confirmUpload(): void {
  if (!pendingFile.value) return;
  emit("upload", pendingFile.value, {
    keepStructure: canKeepStructure.value && keepStructure.value,
    mesh: {
      unit: meshUnit.value,
      split: meshSplit.value,
      minTriangles: meshMinTriangles.value,
      separateTouching: meshSeparateTouching.value,
    },
  });
  uploadDialogVisible.value = false;
  pendingFile.value = null;
}

watch(
  () => props.opacity,
  (val) => {
    if (val !== undefined) localOpacity.value = val;
  },
);

function handleOpacityInput(val: number | number[]): void {
  const v = Array.isArray(val) ? val[0] : val;
  emit("opacityChange", v);
}

function openGitHub(): void {
  window.open("https://github.com/AIResearcherHZ/step2urdf", "_blank", "noopener,noreferrer");
}

defineExpose({ openUploadDialog });
</script>

<style lang="scss" scoped>
.step-viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid var(--line);
  gap: 14px;
  min-height: 48px;
  box-shadow: 0 1px 0 var(--line);
  z-index: 30;

  .toolbar-left,
  .toolbar-center,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-left {
    flex-shrink: 0;
  }

  .toolbar-center {
    flex: 1;
    justify-content: center;
    flex-wrap: wrap;
    min-width: 0;
  }

  .toolbar-right {
    flex-shrink: 0;
  }

  .tb-group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line);

    :deep(.el-button.is-text) {
      background: transparent;
      border-color: transparent;
    }

    :deep(.el-button.is-text:not(.is-disabled):hover) {
      background: var(--surface-1);
      border-color: var(--line);
    }

    :deep(.el-button + .el-button) {
      margin-left: 0;
    }
  }

  .primary-action {
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(26, 33, 29, 0.12);
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 8px;

    .file-name {
      padding: 3px 9px;
      font-size: 12px;
      color: var(--text-2);
      background: var(--surface-3);
      border-radius: 999px;
      box-shadow: inset 0 0 0 1px var(--line);
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .el-divider--vertical {
    height: 20px;
    margin: 0 4px;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 6px;

    .opacity-label {
      font-size: 12px;
      color: var(--text-3);
      white-space: nowrap;
    }

    .el-slider {
      --el-slider-height: 4px;
      --el-slider-button-size: 14px;
    }
  }
}

.wasm-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;

  .el-progress {
    width: 100px;
  }

  .wasm-progress-text {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
  }
}

.github-btn {
  padding: 6px;
  font-size: 0;

  .github-icon {
    color: var(--text-2);
    transition: color 0.2s;
  }

  &:hover .github-icon {
    color: var(--text-1);
  }
}

@media (max-width: 1180px) {
  .step-viewer-toolbar {
    overflow-x: auto;
    justify-content: flex-start;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }

    .toolbar-center {
      order: 3;
      flex: 0 0 auto;
    }
  }
}

.upload-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.upload-placeholder {
  padding: 32px 20px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  .uph-icon-wrap {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: linear-gradient(
      135deg,
      var(--el-color-primary-light-9) 0%,
      var(--el-color-primary-light-9) 100%
    );
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
    transition:
      transform 0.25s ease,
      box-shadow 0.25s ease;

    .uph-icon {
      font-size: 34px;
      color: var(--accent);
      transition: color 0.2s;
    }
  }

  .uph-title {
    font-size: 15px;
    font-weight: 600;
    color: #1d2129;
    margin: 0;
  }

  .uph-sub {
    font-size: 13px;
    color: #86909c;
    margin: 0;

    .uph-browse {
      font-style: normal;
      color: var(--accent);
      font-weight: 500;
    }
  }

  .uph-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;

    .uph-size-note {
      font-size: 11px;
      color: #c9cdd4;
      margin-left: 2px;
    }
  }
}

.selected-file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f8fbff 0%, #f0f7ff 100%);
  border: 1px solid #c6e0ff;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(232, 138, 22, 0.1);

  .sfc-icon-block {
    position: relative;
    flex-shrink: 0;
    line-height: 1;

    .sfc-doc-icon {
      font-size: 38px;
      color: var(--accent);
    }

    .sfc-ext {
      position: absolute;
      bottom: -2px;
      right: -8px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.3px;
      background: var(--accent);
      color: #fff;
      padding: 1px 4px;
      border-radius: 3px;
      line-height: 1.5;
    }
  }

  .sfc-meta {
    flex: 1;
    min-width: 0;

    .sfc-name {
      font-size: 13px;
      font-weight: 500;
      color: #1d2129;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 5px;
    }

    .sfc-detail {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #86909c;

      .sfc-check {
        color: #67c23a;
        font-size: 13px;
        vertical-align: middle;
      }

      .sfc-ready {
        color: #67c23a;
        font-weight: 500;
      }

      .el-divider--vertical {
        height: 10px;
        margin: 0 2px;
      }
    }
  }

  .sfc-remove {
    flex-shrink: 0;
    border-color: #dcdfe6;
    color: var(--text-2);

    &:hover {
      border-color: #f56c6c;
      color: #f56c6c;
      background: #fef0f0;
    }
  }
}

.mesh-options {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line, #ebeef5);
  border-radius: 8px;
  background: #fafbfc;

  .mesh-options-title {
    font-size: 12px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 6px;
  }

  .mesh-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
  }

  .mesh-option-label {
    font-size: 12px;
    color: #606266;
  }

  .mesh-option-hint {
    margin: 6px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: #909399;
  }
}

.file-card-slide-enter-active {
  transition: all 0.28s cubic-bezier(0.34, 1.3, 0.64, 1);
}

.file-card-slide-leave-active {
  transition: all 0.18s ease-in;
}

.file-card-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

.file-card-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

:deep(.step-uploader) {
  width: 100%;

  .el-upload {
    width: 100%;
    display: block;
  }

  .el-upload-dragger {
    width: 100%;
    height: auto;
    padding: 0;
    border: 2px dashed #dde3ed;
    border-radius: 12px;
    background: #fafcff;
    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      border-color: var(--accent);
      background: #f5f9ff;
      box-shadow: 0 0 0 3px rgba(232, 138, 22, 0.08);

      .uph-icon-wrap {
        transform: translateY(-3px);
        box-shadow: 0 6px 16px rgba(232, 138, 22, 0.2);
      }
    }

    &.is-dragover {
      border-color: var(--accent);
      border-style: solid;
      background: linear-gradient(
        135deg,
        var(--el-color-primary-light-9) 0%,
        var(--el-color-primary-light-9) 100%
      );
      box-shadow: 0 0 0 4px rgba(232, 138, 22, 0.12);

      .uph-icon-wrap {
        transform: translateY(-4px) scale(1.05);
        box-shadow: 0 8px 20px rgba(232, 138, 22, 0.25);
      }

      .uph-icon {
        color: var(--accent-plain-text);
      }
    }
  }
}
</style>

<style>
.step-upload-dialog .el-dialog__header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid #f0f2f5;
  margin-right: 0;
}

.step-upload-dialog .el-dialog__headerbtn {
  top: 20px;
  right: 20px;
}

.step-upload-dialog .el-dialog__body {
  padding: 10px;
}

.step-upload-dialog .el-dialog {
  border-radius: 16px;
  overflow: hidden;
}
</style>
border-color: var(--line-strong);
