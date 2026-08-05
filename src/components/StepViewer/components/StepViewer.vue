<template>
  <div class="step-viewer" ref="viewerRef">
    <Toolbar
      ref="toolbarRef"
      :file-name="store.currentFileName"
      :is-loading="store.isLoading"
      :has-model="store.hasModel"
      :has-selection="hasAnySelection"
      :show-axes="store.showAxes"
      :show-grid="store.showGrid"
      :show-stats="showStats"
      :occt-ready="occtReady"
      :occt-load-progress="occtLoadProgress"
      :is-line-measure-active="store.isLineMeasureActive"
      :opacity="opacityPercent"
      :is-model-tree-open="modelTreeVisible"
      :project-saving="persistence.saving.value"
      :autosave-hint="autosaveHint"
      :has-robot-structure="hasRobotStructure"
      @import-robot="robotImportVisible = true"
      @import-robot-package="robotPackageVisible = true"
      @open-projects="handleOpenProjects"
      @save-project="handleSaveProject"
      @upload="handleFileUpload"
      @fit-view="handleFitView"
      @toggle-axes="handleToggleAxes"
      @toggle-grid="handleToggleGrid"
      @opacity-change="handleOpacityChange"
      @clear-selection="handleClearSelection"
      @reset-view="handleResetView"
      @toggle-stats="handleToggleStats"
      @toggle-line-measure="handleToggleLineMeasure"
      @toggle-model-tree="modelTreeVisible = !modelTreeVisible"
    />

    <div class="viewer-content">
      <URDFLeftPanel
        v-if="store.hasModel"
        ref="urdfLeftPanelRef"
        @export-urdf="handleExportURDF"
        @rotate-to-z-up="handleRotateToZUp"
        @reset-orientation="handleResetOrientation"
      />

      <SidePanel
        :visible="modelTreeVisible"
        @tree-select="handleTreeSelect"
        @solid-hover="handleSolidHover"
        @toggle-solid-visibility="handleToggleSolidVisibility"
        @split-solid="handleSplitSolid"
        @rename-solid="handleRenameSolid"
        @merge-solids="handleMergeSolids"
        @close="modelTreeVisible = false"
      />

      <MeasurementPanel
        :visible="measurePanelVisible"
        @remove="handleRemoveMeasurement"
        @clear-all="handleClearMeasurements"
        @close="measurePanelVisible = false"
      />

      <div class="canvas-container" ref="canvasContainerRef">
        <StatsPanel
          :visible="showStats"
          :triangles="modelTriangles"
          :vertices="modelVertices"
          :draw-calls="frameDrawCalls"
          ref="statsPanelRef"
        />

        <Transition name="empty-state">
          <div class="empty-state" v-if="!store.hasModel && !store.isLoading">
            <div class="empty-card">
              <div class="empty-icon"><UploadFilled /></div>
              <h2 class="empty-title">从一个模型开始</h2>
              <p class="empty-desc">
                导入 STEP / STP / STL 几何，或直接载入已有的 URDF / MJCF 结构与机器人包
              </p>
              <div class="empty-actions">
                <el-button
                  type="primary"
                  :icon="UploadFilled"
                  :disabled="store.isLoading"
                  @click="toolbarRef?.openUploadDialog()"
                >
                  导入模型
                </el-button>
                <el-button :icon="Share" @click="robotImportVisible = true">导入结构</el-button>
                <el-button :icon="FolderAdd" @click="robotPackageVisible = true">
                  导入机器人包
                </el-button>
              </div>
              <p class="empty-note" v-if="!occtReady">
                OpenCASCADE 引擎加载中 {{ Math.round(occtLoadProgress ?? 0) }}% — STL
                与结构导入无需等待
              </p>
            </div>
          </div>
        </Transition>

        <LoadingOverlay
          :visible="store.isLoading"
          :progress="store.uploadProgress.progress"
          :message="store.uploadProgress.message"
          :status="store.uploadProgress.status"
          :file-name="store.currentFileName"
        />

        <TransitionGroup name="overlay-item" tag="div" class="overlay-stack">
          <div class="overlay-pill" v-if="urdfStore.bindingMode.active" key="binding">
            <el-tag type="warning" effect="light">
              点击 3D 场景中的 Solid 绑定到 Link（已属其他 Link 会自动改绑，再次点击可解绑）
              <el-button size="small" text @click="urdfStore.stopBindingMode()">完成</el-button>
            </el-tag>
          </div>

          <div class="overlay-pill" v-if="urdfStore.exporting" key="exporting">
            <el-tag type="info" effect="light">
              {{ urdfStore.exportProgress || "正在导出..." }}
            </el-tag>
          </div>

          <div
            class="overlay-pill"
            v-if="!urdfStore.bindingMode.active && selectedSolidIds.length >= 2"
            key="merge"
          >
            <el-tag type="warning" effect="light">
              已选中 {{ selectedSolidIds.length }} 个 Solid
              <el-button size="small" text @click="handleClearSelection">取消选择</el-button>
            </el-tag>
          </div>
        </TransitionGroup>
      </div>

      <URDFRightPanel v-if="store.hasModel" @toggle-f-k-panel="handleToggleFKPanel" />
    </div>

    <FloatingJointControl :visible="fkPanelVisible" @close="fkPanelVisible = false" />

    <ProjectManager
      :visible="projectManagerVisible"
      :projects="persistence.projects.value"
      :current-id="persistence.context.value?.id ?? null"
      :busy="persistence.busy.value"
      :available="persistence.available.value"
      :has-current="store.hasModel && !!persistence.context.value"
      :storage-text="storageText"
      @close="projectManagerVisible = false"
      @open="handleOpenProject"
      @remove="handleRemoveProject"
      @rename="handleRenameProject"
      @import="handleImportProject"
      @export="handleExportProject"
      @clear-geometry="handleClearGeometryCache"
      @clear-all="handleClearAllData"
      @clear-site="handleClearSiteCache"
    />

    <RobotImportDialog
      :visible="robotImportVisible"
      @close="robotImportVisible = false"
      @imported="handleRobotImported"
    />

    <RobotPackageDialog
      :visible="robotPackageVisible"
      @close="robotPackageVisible = false"
      @loaded="handleRobotPackageLoaded"
    />

    <JointWizard
      ref="jointWizardRef"
      @created="urdfScene.handleJointCreated"
      @start-edge-pick="urdfScene.startEdgePickMode"
      @stop-edge-pick="urdfScene.stopEdgePickMode"
      @flip-axis="urdfScene.flipAxis"
      @preview-axis="urdfScene.previewAxisCandidate"
      @show-gizmo="urdfScene.showAxisGizmo"
      @cycle-candidate="urdfScene.cycleAxisCandidate"
      @toggle-xray="urdfScene.setXray"
    />

    <div class="status-bar">
      <template v-if="hint">
        <span class="status-hint">{{ hint }}</span>
      </template>
      <template v-else-if="store.hasModel">
        <span class="status-item"
          >实体: <b>{{ store.solids.length }}</b></span
        >
        <span class="status-sep">|</span>
        <span class="status-item"
          >URDF: <b>{{ urdfStore.robot.name }}</b></span
        >
        <span class="status-sep">|</span>
        <span class="status-item"
          >Links: <b>{{ urdfStore.robot.links.length }}</b></span
        >
        <span class="status-sep">|</span>
        <span class="status-item"
          >Joints: <b>{{ urdfStore.robot.joints.length }}</b></span
        >
        <template v-if="store.selectedSolidNames.length">
          <span class="status-sep">|</span>
          <span class="status-item status-selected">{{ store.selectedSolidNames.join(", ") }}</span>
        </template>
      </template>
      <span v-else class="status-item">{{
        occtReady
          ? "就绪 — 支持 .step / .stp / .stl 模型与 .urdf / .xml 结构导入"
          : "正在加载 OpenCASCADE...（STL 与 URDF 导入无需等待）"
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { confirmDialog, isDialogDismissed, promptDialog } from "../utils/dialog";
import { ElMessage } from "element-plus";
import * as THREE from "three";
import Toolbar from "./Toolbar.vue";
import UploadFilled from "~icons/ep/upload-filled";
import Share from "~icons/ep/share";
import FolderAdd from "~icons/ep/folder-add";
import SidePanel from "./SidePanel.vue";
import MeasurementPanel from "./MeasurementPanel.vue";
import StatsPanel from "./StatsPanel.vue";
import LoadingOverlay from "./LoadingOverlay.vue";
import URDFLeftPanel from "./URDFBuilder/URDFLeftPanel.vue";
import URDFRightPanel from "./URDFBuilder/URDFRightPanel.vue";
import FloatingJointControl from "./URDFBuilder/FloatingJointControl.vue";
import JointWizard from "./URDFBuilder/JointWizard.vue";
import RobotImportDialog from "./URDFBuilder/RobotImportDialog.vue";
import RobotPackageDialog from "./URDFBuilder/RobotPackageDialog.vue";
import ProjectManager from "./ProjectManager.vue";
import { useProjectPersistence } from "../persistence/useProjectPersistence";
import { estimateStorage } from "../persistence/opfs";
import { ProjectFormatError } from "../persistence/types";
import { useStepViewerStore } from "../stores/useStepViewerStore";
import { useURDFStore } from "../stores/useURDFStore";
import { StepLoader, SceneManager, SelectionManager, preloadOcct, isOcctLoaded } from "../core";
import { LineMeasurementTool } from "../core/LineMeasurementTool";
import { disposeKinematicsWorker } from "../core/useKinematicsWorker";
import { disposeInertiaWorker } from "../core/useInertiaWorker";
import { sumImportedMass } from "../core/InertiaModel";
import { terminateWorker } from "../core/StepLoader";
import {
  upAxisToZUpMatrix,
  isIdentityRotation,
  rotateSerializedSolid,
  rotateInertialParams,
  rotateTuple3,
  rotateRPY,
  type UpAxis,
} from "../core/ZUpTransform";
import { useURDFScene } from "./composables/useURDFScene";
import { useGeometryEdit } from "./composables/useGeometryEdit";
import { useHintBar } from "./composables/useHintBar";
import {
  importStlSolids,
  disposeMeshImportWorker,
  MESH_UNIT_SCALES,
} from "../core/useMeshImportWorker";
import { formatBytes } from "../utils/format";
import type {
  TreeNode,
  SerializedSolidData,
  SerializedTreeNode,
  CameraConfig,
  ModelUploadOptions,
  MeshImportSettings,
  RobotPackagePayload,
} from "../types";
import { FeatureType, ViewPreset } from "../types";

const props = withDefaults(
  defineProps<{
    width?: string | number;
    height?: string | number;
    backgroundColor?: number;
    showStatsPanel?: boolean;
  }>(),
  {
    width: "100%",
    height: "100%",
    backgroundColor: 0xf4f4f0,
    showStatsPanel: false,
  },
);

const store = useStepViewerStore();
const urdfStore = useURDFStore();
const { hint } = useHintBar();

const viewerRef = ref<HTMLElement>();
const canvasContainerRef = ref<HTMLElement>();
const statsPanelRef = ref<InstanceType<typeof StatsPanel>>();
const toolbarRef = ref<InstanceType<typeof Toolbar>>();

const showStats = ref(props.showStatsPanel);

const modelTriangles = ref(0);
const modelVertices = ref(0);
const frameDrawCalls = ref(0);

const occtReady = ref(isOcctLoaded());
const occtLoadProgress = ref(isOcctLoaded() ? 100 : 0);

const fkPanelVisible = ref(false);
function handleToggleFKPanel(): void {
  fkPanelVisible.value = !fkPanelVisible.value;
}

const modelTreeVisible = ref(false);
const measurePanelVisible = ref(false);

const exportCompleteAdVisible = ref(false);

let stepLoader: StepLoader | null = null;
let sceneManager: SceneManager | null = null;
let selectionManager: SelectionManager | null = null;
let lineMeasurementTool: LineMeasurementTool | null = null;

const urdfScene = useURDFScene({
  getSceneManager: () => sceneManager,
  getSelectionManager: () => selectionManager,
});

const projectManagerVisible = ref(false);
const robotImportVisible = ref(false);
const robotPackageVisible = ref(false);
const storageText = ref("");

let currentTree: SerializedTreeNode | null = null;

const hasRobotStructure = computed(
  () => urdfStore.robot.links.length > 1 || urdfStore.robot.joints.length > 0,
);

const geometryEdit = useGeometryEdit({
  getStepLoader: () => stepLoader,
  getSceneManager: () => sceneManager,
  getSelectionManager: () => selectionManager,
  disposeUrdfModules: () => urdfScene.disposeModules(),
  initUrdfModules: () => urdfScene.initModules(),
  getCurrentTree: () => currentTree,
  onGeometryChanged: (solids, tree) => {
    currentTree = tree;
    modelTriangles.value = sceneManager?.sceneTriangles ?? 0;
    modelVertices.value = sceneManager?.sceneVertices ?? 0;
    void persistence.cacheGeometry(solids, tree);
  },
});

async function parseModelBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mesh?: MeshImportSettings,
): Promise<{
  solids: SerializedSolidData[];
  tree: SerializedTreeNode | null;
  meshInfo?: { scale: number; diagonal: number; triangles: number };
}> {
  if (!stepLoader) throw new Error("解析器尚未就绪");

  if (fileName.toLowerCase().endsWith(".stl")) {
    const settings: MeshImportSettings = mesh ?? {
      unit: "auto",
      split: true,
      minTriangles: 0,
      separateTouching: true,
    };
    const result = await importStlSolids(
      buffer,
      {
        scale: MESH_UNIT_SCALES[settings.unit] ?? 1,
        autoScale: settings.unit === "auto",
        split: settings.split,
        minTriangles: settings.minTriangles,
        separateTouching: settings.separateTouching,
        baseName: fileName.replace(/\.[^.]+$/, "") || "Mesh",
      },
      (progress) => store.updateUploadProgress(progress),
    );
    return {
      solids: result.solids,
      tree: null,
      meshInfo: { scale: result.scale, diagonal: result.diagonal, triangles: result.triangles },
    };
  }

  const parsed = await stepLoader.parseBuffer(buffer, (progress) =>
    store.updateUploadProgress(progress),
  );
  return { solids: parsed.solids, tree: parsed.tree };
}

function handleRobotImported(): void {
  urdfScene.initModules();
  urdfScene.updateFKAndFrames();
  urdfStore.showFrames = true;
  nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(""));
}

async function handleRobotPackageLoaded(payload: RobotPackagePayload): Promise<void> {
  urdfStore.clearAll();
  store.solidVisibilityMap = new Map();
  store.setFileName(payload.fileName);

  geometryEdit.rebuild(payload.solids, {
    fitView: true,
    tree: payload.tree,
    treeName: payload.fileName,
  });

  urdfStore.importRobot(payload.robot);

  const importedMass = sumImportedMass(payload.robot.links);
  if (importedMass > 0) urdfStore.totalMass = importedMass;
  const bindResult = urdfStore.bindSolidsByLinkNames(
    payload.linkSolidNames,
    store.solids.map((s) => ({ id: s.id, name: s.name })),
  );

  handleRobotImported();

  await nextTick();
  if (sceneManager && canvasContainerRef.value) {
    const { clientWidth, clientHeight } = canvasContainerRef.value;
    if (clientWidth > 0 && clientHeight > 0) sceneManager.updateSize(clientWidth, clientHeight);
    sceneManager.fitToModel();
  }

  modelTreeVisible.value = true;

  ElMessage.success(
    `机器人包加载成功：${payload.robot.links.length} 连杆 / ${payload.robot.joints.length} 关节，` +
      `${payload.solids.length} 个网格实体（${payload.triangles} 三角面），已绑定 ${bindResult.bound} 个`,
  );

  if (payload.warnings.length > 0) {
    ElMessage.warning(
      `有 ${payload.warnings.length} 条提示：${payload.warnings.slice(0, 2).join("；")}`,
    );
  }
}

async function handleRenameSolid(solidId: string): Promise<void> {
  const solid = store.solidMap.get(solidId);
  if (!solid) {
    ElMessage.error(`未找到该 Solid（${solidId}），请刷新模型树后重试`);
    return;
  }

  let value: string;
  try {
    const result = await promptDialog("输入新的 Solid 名称", "重命名 Solid", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: solid.name,
      inputValidator: (v: string) => (v && v.trim().length > 0 ? true : "名称不能为空"),
    });
    value = result.value;
  } catch (error) {
    if (!isDialogDismissed(error)) {
      ElMessage.error(`重命名对话框异常：${(error as Error)?.message ?? error}`);
    }
    return;
  }

  if (!geometryEdit.renameSolid(solidId, value)) {
    ElMessage.info("名称未变化");
    return;
  }
  ElMessage.success(`已重命名为「${value.trim()}」`);
}

async function handleSplitSolid(solidId: string): Promise<void> {
  const solid = store.solidMap.get(solidId);
  if (!solid) return;

  try {
    await confirmDialog(
      `将把「${solid.name}」按连通面片拆解为多个独立 Solid，拆解后可分别设定密度/质量，从而得到更精确的连杆质心与惯量。`,
      "拆解 Solid",
      { confirmButtonText: "拆解", cancelButtonText: "取消", type: "info" },
    );
  } catch {
    return;
  }

  await runSplit([solidId]);
}

const selectedSolidIds = computed(() => store.selectedSolidIds);

async function handleMergeSolids(solidIds: string[]): Promise<void> {
  const names = solidIds.map((id) => store.solidMap.get(id)?.name).filter(Boolean);
  if (names.length < 2) return;

  let value: string;
  try {
    const result = await promptDialog(
      `将把 ${names.length} 个 Solid（${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}）合并为一个，质量取各自之和。`,
      "合并 Solid",
      {
        confirmButtonText: "合并",
        cancelButtonText: "取消",
        inputValue: names[0] as string,
        inputPlaceholder: "合并后的名称",
        inputValidator: (v: string) => (v.trim().length > 0 ? true : "名称不能为空"),
      },
    );
    value = result.value;
  } catch {
    return;
  }

  store.updateUploadProgress({ status: "parsing", progress: 20, message: "正在合并实体..." });
  try {
    const result = await geometryEdit.mergeSolids(solidIds, value);
    store.updateUploadProgress({ status: "success", progress: 100, message: "合并完成" });
    ElMessage.success(`已把 ${result.merged} 个 Solid 合并为「${result.name}」`);
  } catch (error) {
    store.updateUploadProgress({ status: "error", progress: 0, message: "合并失败" });
    ElMessage.error(`合并失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runSplit(solidIds: string[]): Promise<void> {
  if (solidIds.length === 0) return;

  store.updateUploadProgress({ status: "parsing", progress: 20, message: "正在拆解实体..." });
  try {
    const results = await geometryEdit.splitSolids(solidIds);
    const total = results.reduce((sum, r) => sum + Math.max(r.parts, 1), 0);
    store.updateUploadProgress({ status: "success", progress: 100, message: "拆解完成" });

    if (total <= solidIds.length) {
      ElMessage.info("这些实体是单一连通体，无需拆解");
      return;
    }
    ElMessage.success(
      `已将 ${solidIds.length} 个实体拆解为 ${total} 个细 Solid，相关连杆的质心与惯量已同步重算`,
    );
  } catch (error) {
    store.updateUploadProgress({ status: "error", progress: 0, message: "拆解失败" });
    ElMessage.error(`拆解失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function applyRestoredScene(
  solids: SerializedSolidData[],
  tree: SerializedTreeNode | null,
): Promise<void> {
  if (!stepLoader || !sceneManager) throw new Error("渲染器尚未就绪");

  const restored = stepLoader.restoreScene(solids, tree);
  sceneManager.addModel(restored.group);
  currentTree = tree;

  store.setSolids(restored.solids);
  store.setTreeNodes(restored.treeNodes);

  if (selectionManager) {
    selectionManager.setSolids(restored.solids);
    selectionManager.setOpacity(null, store.globalOpacity);
    store.setTransparent(store.globalOpacity < 1);
  }

  modelTriangles.value = sceneManager.sceneTriangles;
  modelVertices.value = sceneManager.sceneVertices;

  await nextTick();

  if (canvasContainerRef.value) {
    const { clientWidth, clientHeight } = canvasContainerRef.value;
    if (clientWidth > 0 && clientHeight > 0) {
      sceneManager.updateSize(clientWidth, clientHeight);
    }
  }

  initURDFModules();
  modelTreeVisible.value = true;
}

const persistence = useProjectPersistence({
  getCamera: () => sceneManager?.getCameraConfig() ?? null,
  setCamera: (config: Partial<CameraConfig>) => sceneManager?.setCameraConfig(config, false),
  captureThumbnail: async () => {
    if (!sceneManager) return null;
    try {
      sceneManager.renderFrame();
      const canvas = sceneManager.getDomElement();
      if (!canvas) return null;
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    } catch {
      return null;
    }
  },
  parseStep: async (bytes, fileName) => {
    store.setFileName(fileName);
    const copy = bytes.slice();
    return parseModelBuffer(copy.buffer as ArrayBuffer, fileName);
  },
  rebuildScene: applyRestoredScene,
  clearWorkspace: () => handleClearAll(),
  onStatus: (message, percent) => {
    store.updateUploadProgress({
      status: percent >= 100 ? "success" : "parsing",
      progress: percent,
      message,
    });
  },
  onInertiaCleared: () => {
    ElMessage.warning(
      "该项目保存于惯量坐标系语义变更之前，其惯量数据已被清除，请重新运行「整机惯量计算」",
    );
  },
});

const autosaveHint = computed(() => {
  if (!persistence.available.value) return "浏览器不支持本地存储，仅可导出 .miles 文件";
  const ts = persistence.lastSavedAt.value;
  if (!ts) return "尚未自动保存";
  return `上次自动保存: ${new Date(ts).toLocaleTimeString()}`;
});

async function refreshStorageText(): Promise<void> {
  const estimate = await estimateStorage();
  if (!estimate) {
    storageText.value = "";
    return;
  }
  const gb = (n: number) => (n / 1024 ** 3).toFixed(2);
  storageText.value = `已用 ${gb(estimate.usage)} GB / 可用 ${gb(estimate.available)} GB`;
}

async function handleOpenProjects(): Promise<void> {
  projectManagerVisible.value = true;
  await persistence.refreshList();
  await refreshStorageText();
}

async function handleSaveProject(): Promise<void> {
  if (!persistence.context.value) {
    ElMessage.warning("请先导入一个 STEP 模型");
    return;
  }
  try {
    const { value } = await promptDialog("为该项目命名", "保存项目", {
      inputValue: persistence.context.value.name,
      inputValidator: (v: string) => (v.trim().length > 0 ? true : "名称不能为空"),
      confirmButtonText: "保存",
      cancelButtonText: "取消",
    });
    await persistence.saveProject(value.trim());
    ElMessage.success("项目已保存");
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleOpenProject(id: string): Promise<void> {
  projectManagerVisible.value = false;
  try {
    await persistence.openProject(id);
    sceneManager?.fitToModel();
    ElMessage.success("项目已恢复");
  } catch (error) {
    store.updateUploadProgress({ status: "error", progress: 0, message: "项目加载失败" });
    ElMessage.error(`项目加载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleRemoveProject(id: string): Promise<void> {
  await persistence.removeProject(id);
  await refreshStorageText();
  ElMessage.success("项目已删除");
}

async function handleRenameProject(id: string, name: string): Promise<void> {
  await persistence.renameProject(id, name);
  ElMessage.success("已重命名");
}

async function handleImportProject(file: File): Promise<void> {
  projectManagerVisible.value = false;
  try {
    await persistence.importProjectFile(file);
    sceneManager?.fitToModel();
    ElMessage.success("项目文件已导入");
  } catch (error) {
    store.updateUploadProgress({ status: "error", progress: 0, message: "导入失败" });
    if (error instanceof ProjectFormatError) {
      ElMessage.error(error.message);
    } else {
      ElMessage.error(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function handleExportProject(): Promise<void> {
  try {
    const saved = await persistence.exportProjectFile();
    if (saved) ElMessage.success("项目文件已导出");
  } catch (error) {
    ElMessage.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleClearGeometryCache(): Promise<void> {
  const { bytes, count } = await persistence.measureGeometryCache();
  if (count === 0) {
    ElMessage.info("没有可清理的几何缓存");
    return;
  }

  try {
    await confirmDialog(
      `将清理 ${count} 个项目的几何缓存，释放约 ${formatBytes(bytes)}。项目配置和 STEP 原文会保留，下次打开这些项目需要重新解析模型。`,
      "清理几何缓存",
      { type: "warning", confirmButtonText: "清理", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }

  const removed = await persistence.clearGeometryCache();
  await persistence.refreshList();
  await refreshStorageText();
  ElMessage.success(`已清理 ${removed} 个几何缓存，释放 ${formatBytes(bytes)}`);
}

async function handleClearAllData(): Promise<void> {
  const estimate = await estimateStorage();

  try {
    await confirmDialog(
      `将永久删除全部 ${persistence.projects.value.length} 个项目及其模型数据、缩略图${estimate ? `（当前占用 ${formatBytes(estimate.usage)}）` : ""}。此操作不可撤销，未导出为 .miles 文件的项目将无法恢复。`,
      "清空全部项目数据",
      {
        type: "error",
        confirmButtonText: "全部删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  await persistence.clearAllData();
  await refreshStorageText();
  ElMessage.success("已清空全部项目数据");
}

async function handleClearSiteCache(): Promise<void> {
  const usage = await persistence.measureSiteCache();

  const parts = [
    `${persistence.projects.value.length} 个项目`,
    `${usage.databases} 个本地数据库`,
    `${usage.caches} 项浏览器缓存`,
  ];
  if (usage.serviceWorkers > 0) parts.push(`${usage.serviceWorkers} 个 Service Worker`);
  const keys = usage.localStorageKeys + usage.sessionStorageKeys;
  if (keys > 0) parts.push(`${keys} 条本地设置`);

  try {
    await confirmDialog(
      `将清除本站的全部本地数据：${parts.join("、")}${usage.totalBytes > 0 ? `，共约 ${formatBytes(usage.totalBytes)}` : ""}。` +
        "此操作不可撤销，未导出为 .miles 文件的项目将无法恢复。清除后页面会自动重新加载。",
      "清除网站全部缓存",
      {
        type: "error",
        confirmButtonText: "清除并重载",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  projectManagerVisible.value = false;

  try {
    const failures = await persistence.resetSite();
    if (failures.length > 0) {
      ElMessage.warning(`部分数据未能清除: ${failures.slice(0, 3).join("、")}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } else {
      ElMessage.success("缓存已清除，正在重新加载...");
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  } catch (error) {
    ElMessage.error(`清除失败: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  window.location.reload();
}

async function promptDraftRecovery(): Promise<void> {
  const draft = await persistence.detectDraft();
  if (!draft) return;

  try {
    await confirmDialog(
      `检测到未保存的会话「${draft.name}」（${draft.sourceFileName}，${new Date(draft.updatedAt).toLocaleString()}），是否恢复？`,
      "恢复上次会话",
      { confirmButtonText: "恢复", cancelButtonText: "丢弃", type: "info" },
    );
    await handleOpenProject(draft.id);
  } catch (action) {
    if (action === "cancel") {
      await persistence.discardDraft();
      ElMessage.info("已丢弃上次会话");
    }
  }
}

const jointWizardRef = ref<InstanceType<typeof JointWizard>>();
const urdfLeftPanelRef = ref<{ setCurrentNodeById: (id: string) => void } | null>(null);
let isHighlightingFromWatcher = false;
let lastActivatedSolidId = "";

const hasAnySelection = computed(
  () =>
    store.selectedFeatures.length > 0 ||
    store.hasTreeSelection ||
    !!urdfStore.selectedLinkId ||
    !!urdfStore.selectedJointId,
);

const effectiveHighlightSolidIds = computed<string[]>(() => {
  if (urdfStore.bindingMode.active && urdfStore.bindingMode.targetLinkId) {
    const link = urdfStore.linkMap.get(urdfStore.bindingMode.targetLinkId);
    return link?.solidIds.slice() ?? [];
  }
  if (store.focusedSolidId && store.solidMap.has(store.focusedSolidId)) {
    return [store.focusedSolidId];
  }
  if (urdfStore.selectedLinkId) {
    const link = urdfStore.linkMap.get(urdfStore.selectedLinkId);
    return link?.solidIds.slice() ?? [];
  }
  if (urdfStore.selectedJointId) {
    const joint = urdfStore.jointMap.get(urdfStore.selectedJointId);
    if (joint) {
      const parentLink = urdfStore.linkMap.get(joint.parentLinkId);
      const childLink = urdfStore.linkMap.get(joint.childLinkId);
      return [...(parentLink?.solidIds ?? []), ...(childLink?.solidIds ?? [])];
    }
  }
  return [];
});

const opacityPercent = computed(() => {
  return Math.round(store.globalOpacity * 100);
});

onMounted(async () => {
  await nextTick();

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  if (!occtReady.value) {
    occtLoadProgress.value = 5;
    progressTimer = setInterval(() => {
      if (occtLoadProgress.value < 90) {
        occtLoadProgress.value += Math.random() * 8 + 2;
        if (occtLoadProgress.value > 90) occtLoadProgress.value = 90;
      }
    }, 600);
  }
  preloadOcct()
    .then(() => {
      if (progressTimer) clearInterval(progressTimer);
      occtLoadProgress.value = 100;
      occtReady.value = true;
      console.log("OpenCASCADE WASM 预加载完成");
      void persistence.refreshList().then(() => promptDraftRecovery());
    })
    .catch((err) => {
      if (progressTimer) clearInterval(progressTimer);
      occtLoadProgress.value = 0;
      console.error("OpenCASCADE 预加载失败:", err);
    });

  await initViewer();

  window.addEventListener("keydown", handleViewShortcut);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleViewShortcut);
  disposeViewer();
});

async function initViewer(): Promise<void> {
  if (!canvasContainerRef.value) return;

  stepLoader = new StepLoader();

  sceneManager = new SceneManager({
    container: canvasContainerRef.value,
    backgroundColor: props.backgroundColor,
    showAxes: store.showAxes,
    showGrid: store.showGrid,
  });

  await sceneManager.waitForReady();

  selectionManager = new SelectionManager({
    camera: sceneManager.camera,
    scene: sceneManager.scene,
    domElement: sceneManager.getDomElement(),
    controls: sceneManager.controls,
    onRenderRequest: () => sceneManager?.requestRender(),
  });

  selectionManager.onSelect((event) => {
    if (isHighlightingFromWatcher) return;

    const features = event.selections.map((s) => s.feature);

    if (urdfStore.bindingMode.active && features.length > 0) {
      urdfScene.handleBindingClick(features[0]);
      return;
    }

    if (urdfScene.isEdgePickMode() && features.length > 0) {
      const f = features[0];
      const isAxisFace =
        f.type === FeatureType.CYLINDER ||
        f.type === FeatureType.CONE ||
        f.type === FeatureType.ARC ||
        f.type === FeatureType.TORUS;
      const isAccepted =
        f.edgeCurveType === "circle" ||
        f.edgeCurveType === "arc" ||
        f.edgeCurveType === "line" ||
        isAxisFace;

      if (!isAccepted) {
        if (f.edgeCurveType === "bspline" || f.edgeCurveType === "bezier") {
          ElMessage.warning("不支持 B 样条/贝塞尔曲线，请选择圆弧边或直线");
        } else {
          ElMessage.warning("请选择圆弧边或直线作为旋转轴参考");
        }
        return;
      }

      if (urdfStore.edgePickEditJointId) {
        urdfScene.applyPickedEdgeToExistingJoint(urdfStore.edgePickEditJointId, f);
      } else {
        jointWizardRef.value?.applyPickedEdge(f);
      }
      return;
    }

    if (urdfStore.basePickMode && features.length > 0) {
      const f = features[0];
      let px = 0,
        py = 0,
        pz = 0;
      if (f.center) {
        px = f.center.x;
        py = f.center.y;
        pz = f.center.z;
      } else if (f.solidId) {
        const solid = store.solidMap.get(f.solidId);
        const pos = solid?.serializedData?.positions;
        if (pos && pos.length >= 3) {
          let sx = 0,
            sy = 0,
            sz = 0,
            n = 0;
          for (let i = 0; i < pos.length; i += 3) {
            sx += pos[i];
            sy += pos[i + 1];
            sz += pos[i + 2];
            n++;
          }
          if (n > 0) {
            px = sx / n;
            py = sy / n;
            pz = sz / n;
          }
        }
      }
      const round = (v: number) => Math.round(v * 10000) / 10000;
      urdfStore.baseLinkOrigin = [round(px), round(py), round(pz)];
      urdfStore.basePickMode = false;
      urdfScene.updateFKAndFrames();
      ElMessage.success("Base Origin 已设置");
      return;
    }

    store.setSelectedFeatures(features);

    if (
      !isHighlightingFromWatcher &&
      !urdfStore.bindingMode.active &&
      features.length > 0 &&
      features[0].solidId
    ) {
      const solidId = features[0].solidId;
      store.setFocusedSolid(solidId);
      const ownerLink = urdfStore.robot.links.find((l) => l.solidIds.includes(solidId));
      if (ownerLink) {
        urdfStore.selectedLinkId = ownerLink.id;
        urdfStore.selectedJointId = null;
        nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(ownerLink.id));
      }
    }

    if (event.selectedTreeNodeIds) {
      for (const id of event.selectedTreeNodeIds) {
        const edgeMatch = id.match(/^(solid_\d+)_edge_\d+$/);
        if (edgeMatch) {
          const parentSolidId = edgeMatch[1];
          if (!store.expandedTreeNodeIds.includes(parentSolidId)) {
            store.expandedTreeNodeIds.push(parentSolidId);
          }
        }
      }
      store.syncTreeFromSelection(event.selectedTreeNodeIds);
    }

    urdfScene.updateFKAndFrames();
    sceneManager?.markDirty();
  });

  selectionManager.onSolidActivate((solidId, multi) => {
    if (!selectionManager) return;
    if (urdfStore.bindingMode.active) return;

    const linkId = urdfStore.solidLinkMap.get(solidId);
    const link = linkId ? urdfStore.linkMap.get(linkId) : null;
    const siblings = link?.solidIds ?? [];

    if (lastActivatedSolidId === solidId && siblings.length > 1) {
      selectionManager.selectSolids(siblings, multi);
      lastActivatedSolidId = "";
      ElMessage.info(`已选中连杆「${link?.name}」的 ${siblings.length} 个 Solid`);
    } else {
      selectionManager.selectBySolidId(solidId, multi);
      lastActivatedSolidId = solidId;
    }

    if (link) {
      urdfStore.selectedLinkId = link.id;
      urdfStore.selectedJointId = null;
      nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(link.id));
    }
    sceneManager?.markDirty();
  });

  selectionManager.onHover((feature) => {
    urdfScene.handleHoverSnap(feature);
  });

  selectionManager.onAxisCandidates((info) => {
    jointWizardRef.value?.setCandidateInfo(info);
  });

  sceneManager.addRenderCallback(() => {
    if (sceneManager) {
      frameDrawCalls.value = sceneManager.frameDrawCalls;
    }
  });

  const domElement = sceneManager.getDomElement();
  domElement.addEventListener("pointerup", handleViewHelperClick);

  lineMeasurementTool = new LineMeasurementTool({
    scene: sceneManager.scene,
    camera: sceneManager.camera,
    domElement: sceneManager.getDomElement(),
    container: canvasContainerRef.value,
    controls: sceneManager.controls,
    onRenderRequest: () => sceneManager?.requestRender(),
    onLineAdded: (line) => {
      store.addLineMeasurement(line);
      sceneManager?.markDirty();
    },
    onLineRemoved: (id) => {
      store.removeLineMeasurement(id);
      sceneManager?.markDirty();
    },
  });

  const resizeObserver = new ResizeObserver(() => {
    if (canvasContainerRef.value && sceneManager) {
      const { clientWidth, clientHeight } = canvasContainerRef.value;
      sceneManager.updateSize(clientWidth, clientHeight);
    }
  });
  resizeObserver.observe(canvasContainerRef.value);
}

function handleViewShortcut(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName;

  if (e.key === "Tab" && urdfScene.isEdgePickMode()) {
    e.preventDefault();
    urdfScene.cycleAxisCandidate(e.shiftKey ? -1 : 1);
    return;
  }

  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "Escape" && hasAnySelection.value) {
    handleClearSelection();
    return;
  }

  if (!sceneManager) return;

  switch (e.key) {
    case "x":
      sceneManager.setViewPreset(ViewPreset.RIGHT);
      break;
    case "X":
      sceneManager.setViewPreset(ViewPreset.LEFT);
      break;
    case "y":
      sceneManager.setViewPreset(ViewPreset.TOP);
      break;
    case "Y":
      sceneManager.setViewPreset(ViewPreset.BOTTOM);
      break;
    case "z":
      sceneManager.setViewPreset(ViewPreset.FRONT);
      break;
    case "Z":
      sceneManager.setViewPreset(ViewPreset.BACK);
      break;
    case "f":
      sceneManager.setViewPreset(ViewPreset.ISOMETRIC);
      break;
    default:
      return;
  }
}

function disposeViewer(): void {
  if (lineMeasurementTool) {
    lineMeasurementTool.dispose();
    lineMeasurementTool = null;
  }

  if (sceneManager) {
    const domElement = sceneManager.getDomElement();
    domElement.removeEventListener("pointerup", handleViewHelperClick);
  }

  urdfScene.disposeModules();
  disposeKinematicsWorker();
  disposeMeshImportWorker();
  disposeInertiaWorker();
  terminateWorker();

  selectionManager?.dispose();
  sceneManager?.dispose();

  stepLoader = null;
  sceneManager = null;
  selectionManager = null;
}

function handleViewHelperClick(event: PointerEvent): void {
  if (sceneManager?.handleViewHelperClick(event)) {
    event.stopPropagation();
    selectionManager?.suppressNextClick();
    lineMeasurementTool?.suppressNextClick();
  }
}

function validateModelFile(file: File): string | null {
  if (!file || file.size === 0) return "文件为空";
  const name = file.name.toLowerCase();
  if (!/\.(step|stp|stl)$/.test(name)) return "仅支持 .step / .stp / .stl 格式文件";
  if (file.size > 500 * 1024 * 1024) return "文件大小超过 500MB 限制";
  return null;
}

async function handleFileUpload(file: File, options?: ModelUploadOptions): Promise<void> {
  if (!stepLoader) return;

  const isStl = file.name.toLowerCase().endsWith(".stl");
  if (!isStl && !occtReady.value) {
    ElMessage.warning("OpenCASCADE 引擎正在加载，请稍候...");
    return;
  }

  const invalid = validateModelFile(file);
  if (invalid) {
    ElMessage.error(invalid);
    return;
  }

  const keepStructure = !!options?.keepStructure && hasRobotStructure.value;

  try {
    if (keepStructure) handleClearGeometryOnly();
    else handleClearAll();
    store.setFileName(file.name);

    store.updateUploadProgress({
      status: "parsing",
      progress: 5,
      message: "准备加载...",
    });

    const buffer = await file.arrayBuffer();
    const parsed = await parseModelBuffer(buffer, file.name, options?.mesh);
    if (parsed.solids.length === 0) throw new Error("文件中没有可用的实体");

    store.updateUploadProgress({
      status: "parsing",
      progress: 90,
      message: "正在渲染模型...",
    });

    const bindResult = geometryEdit.replaceGeometry(parsed.solids, {
      keepStructure,
      autoBind: true,
      tree: parsed.tree,
      treeName: file.name,
      fitView: true,
    });

    if (selectionManager) {
      selectionManager.setOpacity(null, store.globalOpacity);
      store.setTransparent(store.globalOpacity < 1);
    }

    await nextTick();

    if (sceneManager && canvasContainerRef.value) {
      const { clientWidth, clientHeight } = canvasContainerRef.value;
      if (clientWidth > 0 && clientHeight > 0) {
        sceneManager.updateSize(clientWidth, clientHeight);
      }
      sceneManager.fitToModel();
    }

    store.updateUploadProgress({
      status: "success",
      progress: 100,
      message: "加载完成",
    });

    modelTreeVisible.value = true;

    if (keepStructure) {
      urdfScene.updateFKAndFrames();
      ElMessage.success(
        `几何已替换，URDF 结构保留；按名称自动绑定 ${bindResult.bound} 个 Solid` +
          (bindResult.unmatched.length > 0 ? `，${bindResult.unmatched.length} 个未匹配` : ""),
      );
    } else if (parsed.meshInfo) {
      const { scale, diagonal, triangles } = parsed.meshInfo;
      const unitNote =
        options?.mesh?.unit === "auto" && scale !== 1 ? `，已自动按米换算（×${scale}）` : "";
      ElMessage.success(
        `STL 加载成功：${triangles} 个三角面 → ${parsed.solids.length} 个 Solid，` +
          `整体尺寸约 ${diagonal.toFixed(1)} mm${unitNote}`,
      );
    } else {
      ElMessage.success(`模型加载成功，共 ${parsed.solids.length} 个实体`);
    }

    void (async () => {
      try {
        const ctx = await persistence.beginProject(file);
        if (!ctx) return;
        const cached: SerializedSolidData[] = [];
        for (const solid of store.solids) {
          if (solid.serializedData) cached.push(solid.serializedData);
        }
        if (cached.length > 0) {
          await persistence.cacheGeometry(cached, currentTree);
        }
        await persistence.flushSave();
        await persistence.saveThumbnail();
      } catch (error) {
        console.warn("项目自动保存初始化失败:", error);
      }
    })();
  } catch (error) {
    console.error("加载失败:", error);
    store.updateUploadProgress({
      status: "error",
      progress: 0,
      message: error instanceof Error ? error.message : "加载失败",
    });
    ElMessage.error(error instanceof Error ? error.message : "模型加载失败");
  }
}

function handleTreeSelect(node: TreeNode, multi: boolean): void {
  if (!selectionManager) return;

  if (node.type === "solid") {
    const solidId = store.solidIdOfNode(node);
    if (solidId) {
      store.setFocusedSolid(solidId);
      selectionManager.selectBySolidId(solidId, multi);
    }
  } else if (node.type === "edge" && node.edgeIndex !== undefined) {
    const solidId = store.solidIdOfIndex(node.solidIndex);
    if (solidId) {
      selectionManager.selectByEdgeIndex(solidId, node.edgeIndex, multi);
    }
  }

  sceneManager?.markDirty();
}

function handleFitView(): void {
  sceneManager?.fitToModel();
}

function handleToggleAxes(): void {
  const newValue = !store.showAxes;
  store.setShowAxes(newValue);
  sceneManager?.showAxes(newValue);
}

function handleToggleGrid(): void {
  const newValue = !store.showGrid;
  store.setShowGrid(newValue);
  sceneManager?.showGrid(newValue);
}

function handleOpacityChange(percent: number): void {
  const opacity = percent / 100;
  store.setGlobalOpacity(opacity);
  store.setTransparent(opacity < 1);
  urdfScene.syncOpacityBaseline(opacity);
  selectionManager?.setOpacity(null, opacity);
  sceneManager?.markDirty();
}

function handleToggleStats(): void {
  showStats.value = !showStats.value;
}

function handleClearSelection(): void {
  if (urdfStore.bindingMode.active) {
    ElMessage.warning("请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再操作");
    return;
  }
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning("请先点击「✕ 停止拾取」结束关节轴线拾取后再操作");
    return;
  }
  selectionManager?.clearSelection();
  store.clearSelection();
  store.setFocusedSolid(null);
  urdfStore.selectedLinkId = null;
  urdfStore.selectedJointId = null;
  nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(""));
}

function handleResetView(): void {
  sceneManager?.fitToModel();
}

function handleToggleLineMeasure(): void {
  if (!lineMeasurementTool) return;
  const active = !store.isLineMeasureActive;
  store.setLineMeasureActive(active);
  if (active) {
    lineMeasurementTool.activate();
    measurePanelVisible.value = true;
    selectionManager?.setEnabled(false);
  } else {
    lineMeasurementTool.deactivate();
    measurePanelVisible.value = false;
    selectionManager?.setEnabled(true);
  }
  sceneManager?.markDirty();
}

function handleRemoveMeasurement(id: string): void {
  lineMeasurementTool?.removeLine(id);
  sceneManager?.markDirty();
}

function handleClearMeasurements(): void {
  lineMeasurementTool?.clearAll();
  store.clearLineMeasurements();
  sceneManager?.markDirty();
}

function handleClearGeometryOnly(): void {
  handleClearSelection();
  lineMeasurementTool?.clearAll();
  store.clearLineMeasurements();
  if (store.isLineMeasureActive) {
    store.setLineMeasureActive(false);
    lineMeasurementTool?.deactivate();
    selectionManager?.setEnabled(true);
  }

  urdfStore.clearCollisionShapes();
  urdfScene.disposeModules();
  sceneManager?.clearModels();
  store.clearModel();
  currentTree = null;
  modelTriangles.value = 0;
  modelVertices.value = 0;
  frameDrawCalls.value = 0;
}

function handleClearAll(): void {
  handleClearSelection();
  if (lineMeasurementTool) {
    lineMeasurementTool.clearAll();
  }
  store.clearLineMeasurements();
  if (store.isLineMeasureActive) {
    store.setLineMeasureActive(false);
    lineMeasurementTool?.deactivate();
    selectionManager?.setEnabled(true);
  }

  urdfStore.clearAll();
  urdfScene.disposeModules();

  sceneManager?.clearModels();
  store.clearModel();
  currentTree = null;
  modelTriangles.value = 0;
  modelVertices.value = 0;
  frameDrawCalls.value = 0;
}

function initURDFModules(): void {
  urdfScene.initModules();
}

function applyGlobalRotation(m: THREE.Matrix4): boolean {
  if (!stepLoader || !sceneManager) return false;

  const ordered: SerializedSolidData[] = [];
  for (const solid of store.solids) {
    if (!solid.serializedData) {
      ElMessage.warning("部分实体缺少几何数据，无法整机旋转");
      return false;
    }
    ordered.push(solid.serializedData);
  }
  if (ordered.length === 0) return false;

  const previousState = new Map(
    store.solids.map((s) => [s.id, { visible: s.visible, opacity: s.opacity }]),
  );

  for (const data of ordered) {
    rotateSerializedSolid(data, m);
  }

  const childLinkIds = new Set(urdfStore.robot.joints.map((j) => j.childLinkId));
  for (const joint of urdfStore.robot.joints) {
    if (childLinkIds.has(joint.parentLinkId)) continue;
    urdfStore.updateJoint(joint.id, {
      origin: {
        xyz: rotateTuple3(joint.origin.xyz, m, true),
        rpy: rotateRPY(joint.origin.rpy, m),
      },
      axisOffset: rotateTuple3(joint.axisOffset, m, false),
    });
  }

  for (const link of urdfStore.robot.links) {
    if (link.inertial) {
      link.inertial = rotateInertialParams(link.inertial, m);
    }
  }

  if (urdfStore.baseLinkOrigin) {
    urdfStore.baseLinkOrigin = rotateTuple3(urdfStore.baseLinkOrigin, m, true);
  }
  if (urdfStore.baseLinkRPY) {
    urdfStore.baseLinkRPY = rotateRPY(urdfStore.baseLinkRPY, m);
  }

  handleClearSelection();
  lineMeasurementTool?.clearAll();
  store.clearLineMeasurements();
  urdfStore.clearCollisionShapes();
  urdfScene.disposeModules();
  sceneManager.clearModels();

  const { solids, group } = stepLoader.rebuildFromSerialized(ordered);
  sceneManager.addModel(group);
  store.setSolids(solids);

  if (selectionManager) {
    selectionManager.setSolids(solids);
    for (const [solidId, state] of previousState) {
      if (!state.visible) selectionManager.setVisibility(solidId, false);
    }
    selectionManager.setOpacity(null, store.globalOpacity);
  }

  urdfScene.initModules();
  sceneManager.fitToModel();
  modelTriangles.value = sceneManager.sceneTriangles;
  modelVertices.value = sceneManager.sceneVertices;
  return true;
}

function handleRotateToZUp(up: UpAxis): void {
  if (!store.hasModel) {
    ElMessage.warning("请先加载模型");
    return;
  }

  const m = upAxisToZUpMatrix(up);
  if (isIdentityRotation(m)) {
    ElMessage.info("所选朝上轴已是 +Z，无需旋转");
    return;
  }

  const accumulated = new THREE.Matrix4().multiplyMatrices(m, store.getModelRotation());
  if (!applyGlobalRotation(m)) return;

  store.setModelRotation(accumulated);
  ElMessage.success(`已将 ${up} 旋转到 Z-up 右手坐标系`);
}

function handleResetOrientation(): void {
  if (!store.hasModel) {
    ElMessage.warning("请先加载模型");
    return;
  }

  const accumulated = store.getModelRotation();
  if (isIdentityRotation(accumulated)) {
    ElMessage.info("当前已是原始朝向");
    return;
  }

  if (!applyGlobalRotation(accumulated.clone().invert())) return;

  store.setModelRotation(new THREE.Matrix4());
  ElMessage.success("已恢复模型原始朝向");
}

async function handleExportURDF(): Promise<void> {
  await urdfScene.handleExportURDF(exportCompleteAdVisible);
}

watch(
  () => urdfStore.robot.joints,
  () => {
    urdfScene.updateFKAndFrames();
  },
  { deep: true },
);

watch(
  () => urdfStore.showFrames,
  (val) => {
    urdfScene.setFrameVisible(val);
    sceneManager?.markDirty();
  },
);

watch(
  () => urdfStore.collisionShapes,
  () => {
    urdfScene.refreshCollisionVisual();
  },
  { deep: true },
);

watch(
  () => urdfStore.collisionConfig.visible,
  (val) => {
    urdfScene.setCollisionVisible(val);
  },
);

watch(
  () => urdfStore.robot.links.length,
  () => {
    urdfScene.updateFKAndFrames();
  },
);

watch(
  () => urdfStore.edgePickEditJointId,
  (id) => {
    if (id && !urdfScene.isEdgePickMode()) {
      urdfScene.startEdgePickMode();
    } else if (!id && urdfScene.isEdgePickMode()) {
      urdfScene.stopEdgePickMode();
    }
  },
);

watch(
  () => urdfStore.axisHelperScale,
  (scale) => {
    urdfScene.setAxisLength(scale);
  },
);

watch(
  () => urdfStore.baseLinkOrigin,
  () => {
    urdfScene.updateFKAndFrames();
  },
  { deep: true },
);

watch(
  () => urdfStore.baseLinkRPY,
  () => {
    urdfScene.updateFKAndFrames();
  },
  { deep: true },
);

watch(effectiveHighlightSolidIds, (solidIds) => {
  if (!selectionManager) return;
  isHighlightingFromWatcher = true;
  try {
    selectionManager.clearSelection();
    solidIds.forEach((sid) => selectionManager!.selectBySolidId(sid, true));
  } finally {
    isHighlightingFromWatcher = false;
  }
  store.setSelectedFeatures(selectionManager.getSelectedFeatures());
  sceneManager?.markDirty();
});

function handleSolidHover(solidId: string | null): void {
  selectionManager?.hoverBySolidId(solidId);
  sceneManager?.markDirty();
}

function handleToggleSolidVisibility(solidId: string): void {
  store.toggleSolidVisibility(solidId);
  const visible = store.isSolidVisible(solidId);
  selectionManager?.setVisibility(solidId, visible);
  sceneManager?.markDirty();
}

watch(
  () => store.solidVisibilityMap.size,
  () => {
    for (const solid of store.solids) {
      const visible = store.isSolidVisible(solid.id);
      if (solid.mesh) {
        solid.mesh.visible = visible;
      }
    }
    sceneManager?.markDirty();
  },
);

defineExpose({
  fitView: handleFitView,
  clearSelection: handleClearSelection,
  loadFile: handleFileUpload,
});
</script>

<style lang="scss" scoped>
.step-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--surface-0);
  overflow: hidden;
}

.viewer-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  gap: 1px;
  background: var(--line);
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #ffffff 0, #f5f5f0 62%, #eceee8 100%);

  :deep(canvas) {
    display: block;
  }
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: var(--z-canvas-hud);
  pointer-events: none;
}

.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  padding: 32px 36px;
  text-align: center;
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px -28px rgba(26, 33, 29, 0.28);
  backdrop-filter: blur(10px) saturate(1.1);
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 2px;
  font-size: 26px;
  color: var(--accent);
  background: var(--el-color-primary-light-9);
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

.empty-title {
  margin: 0;
  font-size: 17px;
  font-weight: 620;
  letter-spacing: 0.01em;
  color: var(--text-1);
}

.empty-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.empty-note {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-3);
}

.empty-state-enter-active,
.empty-state-leave-active {
  transition:
    opacity 220ms var(--ease-out),
    transform 220ms var(--ease-out);
}

.empty-state-enter-from,
.empty-state-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.overlay-stack {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-canvas-hud);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: min(720px, calc(100% - 24px));
  pointer-events: none;
}

.overlay-pill {
  pointer-events: auto;
  max-width: 100%;

  :deep(.el-tag) {
    height: auto;
    padding: 6px 12px;
    line-height: 1.5;
    white-space: normal;
    border-color: var(--line-strong);
    box-shadow: 0 6px 20px -6px rgba(26, 33, 29, 0.22);
    backdrop-filter: blur(6px);
  }
}

.overlay-item-enter-active,
.overlay-item-leave-active {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}

.overlay-item-enter-from,
.overlay-item-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.overlay-item-leave-active {
  position: absolute;
}

.overlay-item-move {
  transition: transform 200ms var(--ease-out);
}

.status-bar {
  display: flex;
  align-items: center;
  min-height: 27px;
  padding: 4px 14px;
  font-size: 11px;
  letter-spacing: 0.015em;
  color: var(--text-3);
  background: #f8f8f5;
  border-top: 1px solid var(--line);
  white-space: nowrap;
  overflow: hidden;
  gap: 0;

  .status-hint {
    color: var(--text-2);
    animation: hint-in 140ms var(--ease-out);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-item {
    flex-shrink: 0;

    b {
      font-weight: 600;
      color: var(--text-2);
    }
  }

  .status-sep {
    margin: 0 6px;
    color: #c6ccc6;
    flex-shrink: 0;
  }

  .status-selected {
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
}

@keyframes hint-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}
</style>
