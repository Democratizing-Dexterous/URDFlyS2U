<template>
  <div class="step-viewer" ref="viewerRef">
    <!-- 工具栏 -->
    <Toolbar :file-name="store.currentFileName" :is-loading="store.isLoading" :has-model="store.hasModel"
      :has-selection="store.selectedFeatures.length > 0" :show-axes="store.showAxes" :show-grid="store.showGrid"
      :show-stats="showStats" :occt-ready="occtReady" :is-line-measure-active="store.isLineMeasureActive"
      :opacity="opacityPercent" :granularity-mode="store.granularityMode" :view-mode="urdfStore.viewMode"
      @upload="handleFileUpload" @fit-view="handleFitView" @toggle-axes="handleToggleAxes"
      @toggle-grid="handleToggleGrid" @opacity-change="handleOpacityChange"
      @granularity-change="handleGranularityChange" @clear-selection="handleClearSelection"
      @reset-view="handleResetView" @toggle-stats="handleToggleStats" @toggle-side-panel="handleToggleSidePanel"
      @toggle-line-measure="handleToggleLineMeasure" @switch-view-mode="handleSwitchViewMode" />

    <!-- 主内容区域 -->
    <div class="viewer-content">
      <!-- Preview 模式：模型结构树 -->
      <SidePanel v-if="urdfStore.viewMode === 'preview'" @tree-select="handleTreeSelect" />

      <!-- URDF 模式：左侧面板 -->
      <URDFLeftPanel v-if="urdfStore.viewMode === 'urdf' && store.hasModel" ref="urdfLeftPanelRef"
        @export-urdf="handleExportURDF" />

      <!-- 3D 画布 -->
      <div class="canvas-container" ref="canvasContainerRef">
        <!-- 性能监控面板 -->
        <StatsPanel :visible="showStats" :triangles="modelTriangles" :vertices="modelVertices"
          :draw-calls="frameDrawCalls" ref="statsPanelRef" />

        <!-- 加载进度动画 -->
        <LoadingOverlay :visible="store.isLoading" :progress="store.uploadProgress.progress"
          :message="store.uploadProgress.message" :status="store.uploadProgress.status"
          :file-name="store.currentFileName" />

        <!-- 绑定模式提示 -->
        <div class="binding-overlay" v-if="urdfStore.bindingMode.active">
          <el-tag type="warning" effect="dark">
            🎯 点击 3D 场景中的 Solid 绑定到 Link
            <el-button size="small" text style="color: #fff" @click="urdfStore.stopBindingMode()">完成</el-button>
          </el-tag>
        </div>

        <!-- 导出进度提示 -->
        <div class="binding-overlay" v-if="urdfStore.exporting">
          <el-tag type="info" effect="dark">
            ⏳ {{ urdfStore.exportProgress || '正在导出...' }}
          </el-tag>
        </div>

        <!-- 空状态 -->
        <div class="empty-overlay" v-if="!store.hasModel && !store.isLoading">
          <div class="empty-content">
            <svg viewBox="0 0 200 200" width="100" height="100">
              <rect x="50" y="30" width="100" height="140" rx="8" fill="#e6e8eb" stroke="#c0c4cc" stroke-width="2" />
              <line x1="70" y1="60" x2="130" y2="60" stroke="#c0c4cc" stroke-width="2" />
              <line x1="70" y1="80" x2="110" y2="80" stroke="#c0c4cc" stroke-width="2" />
              <line x1="70" y1="100" x2="120" y2="100" stroke="#c0c4cc" stroke-width="2" />
              <path d="M90 130 L100 140 L120 110" stroke="#67c23a" stroke-width="3" fill="none" />
            </svg>
            <p class="empty-text">{{ emptyDescription }}</p>
          </div>
        </div>
      </div>

      <!-- Preview 模式：右侧信息面板 -->
      <RightPanel v-if="urdfStore.viewMode === 'preview'" :visible="store.hasModel"
        @remove-feature="handleRemoveFeature" @remove-measurement="handleRemoveMeasurement"
        @measure-radius="handleMeasureRadius" @measure-diameter="handleMeasureDiameter"
        @measure-distance="handleMeasureDistance" @measure-angle="handleMeasureAngle"
        @clear-measurements="handleClearMeasurements" @remove-line-measurement="handleRemoveLineMeasurement"
        @clear-line-measurements="handleClearLineMeasurements" />

      <!-- URDF 模式：右侧属性面板 -->
      <URDFRightPanel v-if="urdfStore.viewMode === 'urdf' && store.hasModel" @flip-normal="handleFlipNormal" />
    </div>

    <!-- Joint 创建向导 -->
    <JointWizard v-if="urdfStore.viewMode === 'urdf'" ref="jointWizardRef" @created="handleJointCreated"
      @start-edge-pick="startEdgePickMode" @stop-edge-pick="stopEdgePickMode" @flip-normal="handleFlipNormal" />

    <!-- 状态栏 -->
    <div class="status-bar">
      <span v-if="store.hasModel && urdfStore.viewMode === 'preview'">
        实体: {{ store.solids.length }} |
        特征: {{ totalFeatures }} |
        选中: {{ store.selectedFeatures.length }}
        <template v-if="store.selectedSolidNames.length">
          | {{ store.selectedSolidNames.join(', ') }}
        </template>
      </span>
      <span v-else-if="store.hasModel && urdfStore.viewMode === 'urdf'">
        URDF: {{ urdfStore.robot.name }} |
        Links: {{ urdfStore.robot.links.length }} |
        Joints: {{ urdfStore.robot.joints.length }} |
        Chains: {{ urdfStore.chains.length }}
      </span>
      <span v-else>{{ occtReady ? '就绪 — 支持 .step / .stp 文件' : '正在加载 OpenCASCADE...' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import * as THREE from 'three'
import { ElMessage } from 'element-plus'
import Toolbar from './Toolbar.vue'
import SidePanel from './SidePanel.vue'
import RightPanel from './RightPanel.vue'
import StatsPanel from './StatsPanel.vue'
import LoadingOverlay from './LoadingOverlay.vue'
import URDFLeftPanel from './URDFBuilder/URDFLeftPanel.vue'
import URDFRightPanel from './URDFBuilder/URDFRightPanel.vue'
import JointWizard from './URDFBuilder/JointWizard.vue'
import { useStepViewerStore } from '../stores/useStepViewerStore'
import { useURDFStore } from '../stores/useURDFStore'
import {
  StepLoader,
  SceneManager,
  SelectionManager,
  AuxiliaryVisualizer,
  MeasurementTool,
  preloadOcct,
  isOcctLoaded
} from '../core'
import { LineMeasurementTool } from '../core/LineMeasurementTool'
import { FrameVisualizer } from '../core/FrameVisualizer'
import { ForwardKinematics } from '../core/ForwardKinematics'
import { JointSnapVisualizer } from '../core/JointSnapVisualizer'
import { computeRelativeTransform, disposeKinematicsWorker } from '../core/useKinematicsWorker'
import { serializeURDF } from '../core/URDFSerializer'
import type { GeometryFeature, GranularityMode, TreeNode, ViewMode, SnapData } from '../types'
import { FeatureType, ViewPreset } from '../types'

// Props
const props = withDefaults(defineProps<{
  width?: string | number
  height?: string | number
  backgroundColor?: number
  showStatsPanel?: boolean
}>(), {
  width: '100%',
  height: '100%',
  backgroundColor: 0xf5f5f5,
  showStatsPanel: false
})

// Store
const store = useStepViewerStore()
const urdfStore = useURDFStore()

// Refs
const viewerRef = ref<HTMLElement>()
const canvasContainerRef = ref<HTMLElement>()
const statsPanelRef = ref<InstanceType<typeof StatsPanel>>()

// 性能面板状态
const showStats = ref(props.showStatsPanel)

// 性能统计数据
const modelTriangles = ref(0)
const modelVertices = ref(0)
const frameDrawCalls = ref(0)

// OCCT 加载状态
const occtReady = ref(isOcctLoaded())

// 核心模块实例
let stepLoader: StepLoader | null = null
let sceneManager: SceneManager | null = null
let selectionManager: SelectionManager | null = null
let auxiliaryVisualizer: AuxiliaryVisualizer | null = null
let measurementTool: MeasurementTool | null = null
let lineMeasurementTool: LineMeasurementTool | null = null

// URDF 核心模块
let frameVisualizer: FrameVisualizer | null = null
let forwardKinematics: ForwardKinematics | null = null
let snapVisualizer: JointSnapVisualizer | null = null
/** 初始化时按模型尺寸计算的基准轴长，用于与 axisHelperScale 相乘 */
let baseAxisLength = 0.05
const jointWizardRef = ref<InstanceType<typeof JointWizard>>()
const urdfLeftPanelRef = ref<{ setCurrentNodeById: (id: string) => void } | null>(null)
let edgePickMode = false
/** 防止 watcher 触发 3D highlight 时反向触发 onSelect 联动，导致循环选中 */
let isHighlightingFromWatcher = false
/** 当前吸附数据（供点击确认时使用） */
let currentSnapData: SnapData | null = null

// 计算属性
const totalFeatures = computed(() => {
  return store.solids.reduce((sum, solid) => sum + solid.features.length, 0)
})

const emptyDescription = computed(() => {
  return occtReady.value
    ? '请上传 STEP 文件 (.step / .stp)'
    : '正在加载 OpenCASCADE，请稍候...'
})

const opacityPercent = computed(() => {
  return Math.round(store.globalOpacity * 100)
})

// ========== 生命周期 ==========

onMounted(async () => {
  await nextTick()

  // 预加载 OpenCASCADE WASM
  preloadOcct()
    .then(() => {
      occtReady.value = true
      console.log('OpenCASCADE WASM 预加载完成')
    })
    .catch(err => {
      console.error('OpenCASCADE 预加载失败:', err)
    })

  await initViewer()

  // 键盘快捷键：x/y/z 切换六轴视图，f 归位
  window.addEventListener('keydown', handleViewShortcut)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleViewShortcut)
  disposeViewer()
})

// ========== 初始化 ==========

async function initViewer(): Promise<void> {
  if (!canvasContainerRef.value) return

  stepLoader = new StepLoader()

  sceneManager = new SceneManager({
    container: canvasContainerRef.value,
    backgroundColor: props.backgroundColor,
    showAxes: store.showAxes,
    showGrid: store.showGrid
  })

  await sceneManager.waitForReady()

  selectionManager = new SelectionManager({
    camera: sceneManager.camera,
    scene: sceneManager.scene,
    domElement: sceneManager.getDomElement(),
    controls: sceneManager.controls,
    onRenderRequest: () => sceneManager?.requestRender()
  })

  // 选择回调 → 更新 store、辅助线、树同步
  selectionManager.onSelect((event) => {
    // 由 watcher 程序化触发的选择（高亮回放），直接跳过，绝不触发任何业务逻辑
    if (isHighlightingFromWatcher) return

    const features = event.selections.map(s => s.feature)

    // URDF 绑定模式：拦截选择，直接绑定 Solid
    if (urdfStore.viewMode === 'urdf' && urdfStore.bindingMode.active && features.length > 0) {
      handleBindingClick(features[0])
      return
    }

    // URDF 边拾取模式：拦截选择，传给 JointWizard 或已有 Joint
    if (urdfStore.viewMode === 'urdf' && edgePickMode && features.length > 0) {
      const f = features[0]
      const isAccepted = f.edgeCurveType === 'circle' || f.edgeCurveType === 'arc'
        || f.edgeCurveType === 'line' || f.type === FeatureType.CYLINDER

      if (!isAccepted) {
        if (f.edgeCurveType === 'bspline' || f.edgeCurveType === 'bezier') {
          ElMessage.warning('不支持 B 样条/贝塞尔曲线，请选择圆弧边或直线')
        } else {
          ElMessage.warning('请选择圆弧边或直线作为旋转轴参考')
        }
        return
      }

      // 编辑模式：更新已有 Joint 的 origin/axis
      if (urdfStore.edgePickEditJointId) {
        applyPickedEdgeToExistingJoint(urdfStore.edgePickEditJointId, f)
      } else {
        // 创建模式：传给 JointWizard
        jointWizardRef.value?.applyPickedEdge(f)
      }
      return
    }

    // URDF Base Pick 模式：拾取 Solid 面设置 Base Origin
    if (urdfStore.viewMode === 'urdf' && urdfStore.basePickMode && features.length > 0) {
      const f = features[0]
      let px = 0, py = 0, pz = 0
      if (f.center) {
        px = f.center.x; py = f.center.y; pz = f.center.z
      } else if (f.solidId) {
        const solid = store.solidMap.get(f.solidId)
        const pos = solid?.serializedData?.positions
        if (pos && pos.length >= 3) {
          let sx = 0, sy = 0, sz = 0, n = 0
          for (let i = 0; i < pos.length; i += 3) { sx += pos[i]; sy += pos[i + 1]; sz += pos[i + 2]; n++ }
          if (n > 0) { px = sx / n; py = sy / n; pz = sz / n }
        }
      }
      const round = (v: number) => Math.round(v * 10000) / 10000
      urdfStore.baseLinkOrigin = [round(px), round(py), round(pz)]
      urdfStore.basePickMode = false
      updateFKAndFrames()
      ElMessage.success('Base Origin 已设置')
      return
    }

    store.setSelectedFeatures(features)

    // URDF 模式：3D 点击 Solid → 反向联动左侧树选中对应 Link
    // isHighlightingFromWatcher 为 true 或绑定模式激活时不进行反向联动（避免切换右侧面板）
    if (!isHighlightingFromWatcher && urdfStore.viewMode === 'urdf'
      && !urdfStore.bindingMode.active
      && features.length > 0 && features[0].solidId) {
      const solidId = features[0].solidId
      const ownerLink = urdfStore.robot.links.find(l => l.solidIds.includes(solidId))
      if (ownerLink) {
        urdfStore.selectedLinkId = ownerLink.id
        urdfStore.selectedJointId = null
        nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(ownerLink.id))
      }
    }

    // 同步树节点选中
    if (event.selectedTreeNodeIds) {
      // 自动展开被选中边节点的父级 solid 节点
      for (const id of event.selectedTreeNodeIds) {
        const edgeMatch = id.match(/^(solid_\d+)_edge_\d+$/)
        if (edgeMatch) {
          const parentSolidId = edgeMatch[1]
          if (!store.expandedTreeNodeIds.includes(parentSolidId)) {
            store.expandedTreeNodeIds.push(parentSolidId)
          }
        }
      }
      store.syncTreeFromSelection(event.selectedTreeNodeIds)
    }

    updateAuxiliaryLines()
    sceneManager?.markDirty()
  })

  // Hover 回调 → 驱动 Snap Gizmo 可视化
  selectionManager.onHover((feature) => {
    if (!edgePickMode || !snapVisualizer) {
      snapVisualizer?.hide()
      currentSnapData = null
      return
    }

    if (!feature) {
      snapVisualizer.hide()
      currentSnapData = null
      sceneManager?.markDirty()
      return
    }

    // 仅处理圆弧边和直线边
    if (feature.edgeCurveType === 'circle' || feature.edgeCurveType === 'arc') {
      if (feature.center && (feature.axis || feature.normal)) {
        const pos = feature.center
        const norm = (feature.axis || feature.normal)!
        snapVisualizer.updateSnap(pos, norm)
        currentSnapData = {
          position: [pos.x, pos.y, pos.z],
          normal: [norm.x, norm.y, norm.z],
          featureType: feature.edgeCurveType as 'circle' | 'arc'
        }
        sceneManager?.markDirty()
      }
    } else if (feature.edgeCurveType === 'line') {
      if (feature.startPoint && feature.endPoint) {
        const pos = feature.startPoint
        const dir = feature.endPoint.clone().sub(feature.startPoint).normalize()
        snapVisualizer.updateSnap(pos, dir)
        currentSnapData = {
          position: [pos.x, pos.y, pos.z],
          normal: [dir.x, dir.y, dir.z],
          featureType: 'line'
        }
        sceneManager?.markDirty()
      }
    } else {
      snapVisualizer.hide()
      currentSnapData = null
    }
  })

  // 辅助可视化
  auxiliaryVisualizer = new AuxiliaryVisualizer({
    scene: sceneManager.scene
  })

  // 测量工具
  measurementTool = new MeasurementTool({
    scene: sceneManager.scene,
    camera: sceneManager.camera,
    container: canvasContainerRef.value
  })

  // 渲染回调
  sceneManager.addRenderCallback(() => {
    measurementTool?.render()
    if (sceneManager) {
      frameDrawCalls.value = sceneManager.frameDrawCalls
    }
  })

  // ViewHelper 点击处理（使用 pointerup 而非 click，与 ViewHelper API 一致）
  const domElement = sceneManager.getDomElement()
  domElement.addEventListener('pointerup', handleViewHelperClick)

  // 初始化画线测量工具
  lineMeasurementTool = new LineMeasurementTool({
    scene: sceneManager.scene,
    camera: sceneManager.camera,
    domElement: sceneManager.getDomElement(),
    container: canvasContainerRef.value,
    controls: sceneManager.controls,
    labelRenderer: measurementTool!.getLabelRenderer(),
    onRenderRequest: () => sceneManager?.requestRender(),
    onLineAdded: (line) => {
      store.addLineMeasurement(line)
      sceneManager?.markDirty()
    },
    onLineRemoved: (id) => {
      store.removeLineMeasurement(id)
      sceneManager?.markDirty()
    }
  })

  // 尺寸监听
  const resizeObserver = new ResizeObserver(() => {
    if (canvasContainerRef.value && sceneManager && measurementTool) {
      const { clientWidth, clientHeight } = canvasContainerRef.value
      sceneManager.updateSize(clientWidth, clientHeight)
      measurementTool.updateSize(clientWidth, clientHeight)
    }
  })
  resizeObserver.observe(canvasContainerRef.value)
}

// ========== 辅助方法 ==========

function updateAuxiliaryLines(): void {
  if (!auxiliaryVisualizer) return
  auxiliaryVisualizer.clearAll()
  store.featuresWithNormalLine.forEach(feature => {
    auxiliaryVisualizer?.showNormalLine(feature)
  })
}

// ========== 键盘视角快捷键 ==========
// x → X+ 右视图  X(Shift+x) → X- 左视图
// y → Y+ 顶视图  Y(Shift+y) → Y- 底视图
// z → Z+ 前视图  Z(Shift+z) → Z- 后视图
// f → 等轴测归位
function handleViewShortcut(e: KeyboardEvent): void {
  // 正在输入文字时不触发
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (!sceneManager) return

  switch (e.key) {
    case 'x': sceneManager.setViewPreset(ViewPreset.RIGHT); break  // +X 轴视图（右面）
    case 'X': sceneManager.setViewPreset(ViewPreset.LEFT); break  // -X 轴视图（左面）
    case 'y': sceneManager.setViewPreset(ViewPreset.TOP); break  // +Y 轴视图（顶面）
    case 'Y': sceneManager.setViewPreset(ViewPreset.BOTTOM); break  // -Y 轴视图（底面）
    case 'z': sceneManager.setViewPreset(ViewPreset.FRONT); break  // +Z 轴视图（前面）
    case 'Z': sceneManager.setViewPreset(ViewPreset.BACK); break  // -Z 轴视图（后面）
    case 'f': sceneManager.setViewPreset(ViewPreset.ISOMETRIC); break // 等轴测归位
    default: return
  }
}

function disposeViewer(): void {
  // 离开画线模式
  if (lineMeasurementTool) {
    lineMeasurementTool.dispose()
    lineMeasurementTool = null
  }

  // 移除 ViewHelper 事件
  if (sceneManager) {
    const domElement = sceneManager.getDomElement()
    domElement.removeEventListener('pointerup', handleViewHelperClick)
  }

  // 清理 URDF 模块
  frameVisualizer?.dispose()
  frameVisualizer = null
  snapVisualizer?.dispose()
  snapVisualizer = null
  disposeKinematicsWorker()
  forwardKinematics = null

  measurementTool?.dispose()
  auxiliaryVisualizer?.dispose()
  selectionManager?.dispose()
  sceneManager?.dispose()

  stepLoader = null
  sceneManager = null
  selectionManager = null
  auxiliaryVisualizer = null
  measurementTool = null
}

// ========== ViewHelper ==========

function handleViewHelperClick(event: PointerEvent): void {
  if (sceneManager?.handleViewHelperClick(event)) {
    // ViewHelper 吃掉了事件，不要传给 SelectionManager
    event.stopPropagation()
  }
}

// ========== 文件上传 ==========

async function handleFileUpload(file: File): Promise<void> {
  if (!stepLoader) return

  // ★ 确保 OCCT 已加载
  if (!occtReady.value) {
    ElMessage.warning('OpenCASCADE 引擎正在加载，请稍候...')
    return
  }

  const validation = stepLoader.validateFile(file)
  if (!validation.valid) {
    ElMessage.error(validation.error || '文件校验失败')
    return
  }

  try {
    handleClearAll()
    store.setFileName(file.name)

    store.updateUploadProgress({
      status: 'parsing',
      progress: 5,
      message: '准备加载...'
    })

    const { solids, group, treeNodes } = await stepLoader.loadFile(file, (progress) => {
      if (progress.status === 'success') {
        store.updateUploadProgress({
          status: 'parsing',
          progress: 90,
          message: '正在渲染模型...'
        })
      } else {
        store.updateUploadProgress(progress)
      }
    })

    // 添加到场景
    if (sceneManager) {
      sceneManager.addModel(group)
      sceneManager.fitToModel()
    }

    // 更新 store
    store.setSolids(solids)
    store.setTreeNodes(treeNodes)

    // 设置选择管理器
    if (selectionManager) {
      selectionManager.setSolids(solids)
      // 应用 store 中已配置的初始透明度（默认 0.3）
      selectionManager.setOpacity(null, store.globalOpacity)
      store.setTransparent(store.globalOpacity < 1)
    }

    // 更新统计
    modelTriangles.value = sceneManager?.sceneTriangles ?? 0
    modelVertices.value = sceneManager?.sceneVertices ?? 0

    await nextTick()

    // ★ 确保模型可见：布局变化后强制重新适配 + 延迟再次渲染
    if (sceneManager && canvasContainerRef.value) {
      const { clientWidth, clientHeight } = canvasContainerRef.value
      if (clientWidth > 0 && clientHeight > 0) {
        sceneManager.updateSize(clientWidth, clientHeight)
        measurementTool?.updateSize(clientWidth, clientHeight)
      }
      sceneManager.fitToModel()
    }

    store.updateUploadProgress({
      status: 'success',
      progress: 100,
      message: '加载完成'
    })

    ElMessage.success('模型加载成功')
  } catch (error) {
    console.error('加载失败:', error)
    store.updateUploadProgress({
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : '加载失败'
    })
    ElMessage.error(error instanceof Error ? error.message : '模型加载失败')
  }
}

// ========== 树选择（双向同步） ==========

/**
 * 从模型树选择节点 → 3D 高亮
 * ★ 使用 ID 查找而非数组索引，避免 InstancedMesh 分组后顺序改变导致的错位
 */
function handleTreeSelect(node: TreeNode, multi: boolean): void {
  if (!selectionManager) return

  if (node.type === 'solid' && node.solidIndex !== undefined) {
    const solidId = `solid_${node.solidIndex}`
    const solid = store.solidMap.get(solidId)
    if (solid) {
      selectionManager.selectBySolidId(solid.id, multi)
    }
  } else if (node.type === 'edge' && node.solidIndex !== undefined && node.edgeIndex !== undefined) {
    const solidId = `solid_${node.solidIndex}`
    const solid = store.solidMap.get(solidId)
    if (solid) {
      selectionManager.selectByEdgeIndex(solid.id, node.edgeIndex, multi)
    }
  }

  sceneManager?.markDirty()
}

// ========== 工具栏事件 ==========

function handleFitView(): void {
  sceneManager?.fitToModel()
}

function handleToggleAxes(): void {
  const newValue = !store.showAxes
  store.setShowAxes(newValue)
  sceneManager?.showAxes(newValue)
}

function handleToggleGrid(): void {
  const newValue = !store.showGrid
  store.setShowGrid(newValue)
  sceneManager?.showGrid(newValue)
}

function handleOpacityChange(percent: number): void {
  const opacity = percent / 100
  store.setGlobalOpacity(opacity)
  store.setTransparent(opacity < 1)
  selectionManager?.setOpacity(null, opacity)
  sceneManager?.markDirty()
}

function handleGranularityChange(mode: GranularityMode): void {
  if (mode === store.granularityMode) return
  store.setGranularityMode(mode)
  selectionManager?.setGranularityMode(mode)
  // 清除辅助可视化
  auxiliaryVisualizer?.clearAll()
  sceneManager?.markDirty()
}

function handleToggleStats(): void {
  showStats.value = !showStats.value
}

function handleToggleSidePanel(): void {
  store.toggleSidePanel()
}

function handleClearMeasurements(): void {
  measurementTool?.clearAllMeasurements()
  store.clearMeasurements()
  sceneManager?.markDirty()
}

function handleRemoveLineMeasurement(id: string): void {
  lineMeasurementTool?.removeLine(id)
  store.removeLineMeasurement(id)
  sceneManager?.markDirty()
}

function handleClearLineMeasurements(): void {
  lineMeasurementTool?.clearAll()
  store.clearLineMeasurements()
  sceneManager?.markDirty()
}

function handleClearSelection(): void {
  // 绑定模式 / 边拾取模式下禁止清除选择（保护当前工作现场）
  if (urdfStore.viewMode === 'urdf') {
    if (urdfStore.bindingMode.active) {
      ElMessage.warning('请先点击「✅ 完成绑定」按钮，完成当前 Solid 绑定后再操作')
      return
    }
    if (urdfStore.edgePickEditJointId) {
      ElMessage.warning('请先点击「✕ 停止拾取」结束关节轴线拾取后再操作')
      return
    }
  }
  selectionManager?.clearSelection()
  store.clearSelection()
  auxiliaryVisualizer?.clearAll()
  // URDF 模式下，同步清除树选中状态
  if (urdfStore.viewMode === 'urdf') {
    urdfStore.selectedLinkId = null
    urdfStore.selectedJointId = null
    nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(''))
  }
}

function handleResetView(): void {
  sceneManager?.fitToModel()
}

// ========== 画线测量 ==========

function handleToggleLineMeasure(): void {
  if (!lineMeasurementTool) return
  const active = !store.isLineMeasureActive
  store.setLineMeasureActive(active)
  if (active) {
    lineMeasurementTool.activate()
    // 画线模式下禁用选择管理器
    selectionManager?.setEnabled(false)
  } else {
    lineMeasurementTool.deactivate()
    selectionManager?.setEnabled(true)
  }
  sceneManager?.markDirty()
}

// ========== InfoPanel 事件（通过 SidePanel 透传） ==========

function handleRemoveFeature(featureId: string): void {
  // deselectFeature 内部会触发 onSelectCallback 更新 store（selectedFeatures + selectedTreeNodeIds）
  selectionManager?.deselectFeature(featureId)
  auxiliaryVisualizer?.clearFeatureAuxiliary(featureId)
  sceneManager?.markDirty()
}

function handleRemoveMeasurement(id: string): void {
  measurementTool?.removeMeasurement(id)
  store.removeMeasurement(id)
  sceneManager?.markDirty()
}

function handleMeasureRadius(): void {
  if (!measurementTool || store.selectedFeatures.length !== 1) return
  const result = measurementTool.measureRadius(store.selectedFeatures[0])
  if (result) {
    store.addMeasurement(result)
    sceneManager?.markDirty()
  } else {
    ElMessage.warning('无法测量该特征的半径')
  }
}

function handleMeasureDiameter(): void {
  if (!measurementTool || store.selectedFeatures.length !== 1) return
  const result = measurementTool.measureDiameter(store.selectedFeatures[0])
  if (result) {
    store.addMeasurement(result)
    sceneManager?.markDirty()
  } else {
    ElMessage.warning('无法测量该特征的直径')
  }
}

function handleMeasureDistance(): void {
  if (!measurementTool || store.selectedFeatures.length !== 2) return
  const result = measurementTool.measureFeatures(
    store.selectedFeatures[0],
    store.selectedFeatures[1]
  )
  if (result) {
    store.addMeasurement(result)
    sceneManager?.markDirty()
  } else {
    ElMessage.warning('无法测量这两个特征之间的距离')
  }
}

function handleMeasureAngle(): void {
  if (!measurementTool || store.selectedFeatures.length !== 2) return
  const result = measurementTool.measureAngle(store.selectedFeatures[0], store.selectedFeatures[1])
  if (result) {
    store.addMeasurement(result)
    sceneManager?.markDirty()
  } else {
    ElMessage.warning('无法测量这两个特征之间的角度')
  }
}

function handleClearAll(): void {
  handleClearSelection()
  handleClearMeasurements()
  // 清理画线测量
  if (lineMeasurementTool) {
    lineMeasurementTool.clearAll()
  }
  store.clearLineMeasurements()
  if (store.isLineMeasureActive) {
    store.setLineMeasureActive(false)
    lineMeasurementTool?.deactivate()
    selectionManager?.setEnabled(true)
  }
  sceneManager?.clearModels()
  store.clearModel()
  modelTriangles.value = 0
  modelVertices.value = 0
  frameDrawCalls.value = 0
}

// ========== URDF 双视图切换 ==========

function handleSwitchViewMode(mode: ViewMode): void {
  urdfStore.viewMode = mode
  if (mode === 'urdf') {
    // 切换到 URDF 模式时初始化 URDF 模块
    initURDFModules()
  } else {
    // 切换回 Preview 模式时清理 URDF 辅助可视化
    frameVisualizer?.setVisible(false)
    snapVisualizer?.hide()
    currentSnapData = null
    resetFKTransforms()
  }
  sceneManager?.markDirty()
}

function initURDFModules(): void {
  if (!sceneManager) return

  // 根据模型包围盒自动计算可视化轴长度
  const box = new THREE.Box3().setFromObject(sceneManager.modelGroup)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  baseAxisLength = maxDim > 0 ? maxDim * 0.05 : 0.05
  const axisLength = baseAxisLength * urdfStore.axisHelperScale

  // (Re)create visualizers with model-scale axis length
  frameVisualizer?.dispose()
  frameVisualizer = new FrameVisualizer({ scene: sceneManager.scene, axisLength })

  if (!forwardKinematics) {
    forwardKinematics = new ForwardKinematics()
  }

  snapVisualizer?.dispose()
  snapVisualizer = new JointSnapVisualizer({ scene: sceneManager.scene, axisLength })

  // 同步当前状态
  forwardKinematics.setRobot(urdfStore.robot)
  frameVisualizer.setVisible(urdfStore.showFrames)
  updateFKAndFrames()
}

function updateFKAndFrames(): void {
  if (!forwardKinematics || !sceneManager) return

  forwardKinematics.setRobot(urdfStore.robot)
  const transforms = forwardKinematics.compute()

  // 将 FK 结果写入 store，供 JointWizard 等组件读取
  urdfStore.linkWorldTransforms = transforms

  // 应用 FK 变换到 3D 场景
  forwardKinematics.applyToScene(transforms, urdfStore.robot.links, store.solidMap)

  // 更新关节坐标系可视化
  if (frameVisualizer && urdfStore.showFrames) {
    frameVisualizer.showAllFrames(urdfStore.robot.joints)
    for (const joint of urdfStore.robot.joints) {
      const wm = forwardKinematics.getJointWorldMatrix(joint.id)
      if (wm) {
        frameVisualizer.updateFrameTransform(joint.id, wm)
      }
    }
    // Base Link 坐标系（常显，标识机器人原点）
    frameVisualizer.showBaseFrame(urdfStore.baseLinkOrigin, urdfStore.baseLinkRPY ?? undefined)
  }

  sceneManager.markDirty()
}

function resetFKTransforms(): void {
  if (!forwardKinematics) return
  forwardKinematics.resetScene(urdfStore.robot.links, store.solidMap)
  sceneManager?.markDirty()
}

// ========== URDF Binding Mode 点击 ==========

function handleBindingClick(feature: GeometryFeature): void {
  if (!urdfStore.bindingMode.active || !urdfStore.bindingMode.targetLinkId) return
  if (!feature.solidId) return

  // 检查该 Solid 是否已被其他 Link 绑定
  if (urdfStore.boundSolidIds.has(feature.solidId)) {
    ElMessage.warning('该 Solid 已被其他 Link 绑定')
    return
  }

  urdfStore.bindSolid(urdfStore.bindingMode.targetLinkId, feature.solidId)

  // 绑定后重新高亮所有已绑 Solid（包括刚绑定的）
  if (selectionManager) {
    isHighlightingFromWatcher = true
    try {
      selectionManager.clearSelection()
      const link = urdfStore.linkMap.get(urdfStore.bindingMode.targetLinkId)
      link?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
    } finally {
      isHighlightingFromWatcher = false
    }
    sceneManager?.markDirty()
  }
  const link = urdfStore.linkMap.get(urdfStore.bindingMode.targetLinkId)
  // ElMessage.success(`Solid 已绑定到 ${link?.name}（继续点击绑定更多，或点完成退出）`)
}

// ========== JointWizard 相关 ==========

function handleJointCreated(jointId: string): void {
  // 确保坐标系可见
  urdfStore.showFrames = true
  // 隐藏吸附 Gizmo
  snapVisualizer?.hide()
  currentSnapData = null
  updateFKAndFrames()
}

/** 反转吸附 Gizmo 的 Z 轴方向 */
function handleFlipNormal(): void {
  if (!snapVisualizer?.isVisible()) return
  snapVisualizer.flipNormal()
  // 同步更新 currentSnapData
  if (currentSnapData) {
    const n = snapVisualizer.getCurrentNormal()
    currentSnapData.normal = [n.x, n.y, n.z]
  }
  sceneManager?.markDirty()
}

function startEdgePickMode(): void {
  edgePickMode = true
  // 切换到边选取模式
  if (selectionManager) {
    selectionManager.setGranularityMode('edge')
  }
}

function stopEdgePickMode(): void {
  edgePickMode = false
  urdfStore.edgePickEditJointId = null
  // 隐藏吸附 Gizmo
  snapVisualizer?.hide()
  currentSnapData = null
  // 恢复之前的选取模式
  if (selectionManager) {
    selectionManager.setGranularityMode(store.granularityMode)
  }
  sceneManager?.markDirty()
}

/** 将拾取到的边特征应用到已有 Joint 的 origin/axis（通过 Worker 计算相对坐标） */
async function applyPickedEdgeToExistingJoint(jointId: string, feature: GeometryFeature): Promise<void> {
  const joint = urdfStore.jointMap.get(jointId)
  if (!joint) return

  // 提取 snap 数据
  let snapPos: [number, number, number]
  let snapNorm: [number, number, number]

  if (feature.edgeCurveType === 'line') {
    if (!feature.startPoint || !feature.endPoint) return
    const dir = feature.endPoint.clone().sub(feature.startPoint).normalize()
    snapPos = [feature.startPoint.x, feature.startPoint.y, feature.startPoint.z]
    snapNorm = [dir.x, dir.y, dir.z]
  } else {
    if (!feature.center || (!feature.axis && !feature.normal)) return
    const norm = (feature.axis || feature.normal)!
    snapPos = [feature.center.x, feature.center.y, feature.center.z]
    snapNorm = [norm.x, norm.y, norm.z]
  }

  // 获取父级世界矩阵
  const parentWorld = urdfStore.linkWorldTransforms.get(joint.parentLinkId)
  const parentElements = parentWorld ? parentWorld.elements : new THREE.Matrix4().elements

  // Worker 计算相对坐标
  const result = await computeRelativeTransform(parentElements, snapPos, snapNorm)

  joint.origin.xyz = result.xyz
  joint.origin.rpy = result.rpy
  // RPY 已将关节局部 Z 轴对齐到 snapNormal，因此 axis 为局部 Z
  joint.axis = [0, 0, 1]

  ElMessage.success('已更新关节参数')
}

// ========== URDF 导出 ==========

/** 从三角化数据生成 binary STL（纯数学，无需 OCCT）
 *  @param restInverse Link 静息世界矩阵的逆，将顶点从世界坐标转到 Link 局部坐标
 */
function generateBinarySTL(
  solidDataList: import('../types').SerializedSolidData[],
  restInverse?: THREE.Matrix4,
  unitScale: number = 1
): ArrayBuffer {
  let totalTriangles = 0
  for (const sd of solidDataList) totalTriangles += sd.indices.length / 3

  const bufferSize = 80 + 4 + totalTriangles * 50
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)
  let offset = 80
  view.setUint32(offset, totalTriangles, true)
  offset += 4

  // 预提取逆矩阵元素用于手动变换（避免每个顶点创建 Vector3）
  const hasTransform = !!restInverse
  const me = restInverse?.elements ?? new Float64Array(16)

  for (const sd of solidDataList) {
    const pos = sd.positions, idx = sd.indices
    for (let t = 0, n = idx.length / 3; t < n; t++) {
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2]

      // 读取三个顶点并可选地变换到 Link 局部坐标
      let p0x = pos[i0 * 3], p0y = pos[i0 * 3 + 1], p0z = pos[i0 * 3 + 2]
      let p1x = pos[i1 * 3], p1y = pos[i1 * 3 + 1], p1z = pos[i1 * 3 + 2]
      let p2x = pos[i2 * 3], p2y = pos[i2 * 3 + 1], p2z = pos[i2 * 3 + 2]

      if (hasTransform) {
        // M × [x,y,z,1] — 列主序 Matrix4
        const _p0x = me[0] * p0x + me[4] * p0y + me[8] * p0z + me[12]
        const _p0y = me[1] * p0x + me[5] * p0y + me[9] * p0z + me[13]
        const _p0z = me[2] * p0x + me[6] * p0y + me[10] * p0z + me[14]
        p0x = _p0x; p0y = _p0y; p0z = _p0z

        const _p1x = me[0] * p1x + me[4] * p1y + me[8] * p1z + me[12]
        const _p1y = me[1] * p1x + me[5] * p1y + me[9] * p1z + me[13]
        const _p1z = me[2] * p1x + me[6] * p1y + me[10] * p1z + me[14]
        p1x = _p1x; p1y = _p1y; p1z = _p1z

        const _p2x = me[0] * p2x + me[4] * p2y + me[8] * p2z + me[12]
        const _p2y = me[1] * p2x + me[5] * p2y + me[9] * p2z + me[13]
        const _p2z = me[2] * p2x + me[6] * p2y + me[10] * p2z + me[14]
        p2x = _p2x; p2y = _p2y; p2z = _p2z
      }

      // 计算面法线
      const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z
      const bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len; ny /= len; nz /= len

      view.setFloat32(offset, nx, true); offset += 4
      view.setFloat32(offset, ny, true); offset += 4
      view.setFloat32(offset, nz, true); offset += 4

      // 应用单位缩放（mm → m）
      const sc = unitScale
      view.setFloat32(offset, p0x * sc, true); offset += 4
      view.setFloat32(offset, p0y * sc, true); offset += 4
      view.setFloat32(offset, p0z * sc, true); offset += 4
      view.setFloat32(offset, p1x * sc, true); offset += 4
      view.setFloat32(offset, p1y * sc, true); offset += 4
      view.setFloat32(offset, p1z * sc, true); offset += 4
      view.setFloat32(offset, p2x * sc, true); offset += 4
      view.setFloat32(offset, p2y * sc, true); offset += 4
      view.setFloat32(offset, p2z * sc, true); offset += 4

      view.setUint16(offset, 0, true); offset += 2
    }
  }
  return buffer
}

async function handleExportURDF(): Promise<void> {
  // 孤立 Link 警告
  const orphans = urdfStore.findOrphanLinks()
  if (orphans.length > 0) {
    ElMessage.warning(`以下 Link 未被任何 Joint 连接: ${orphans.join(', ')}`)
  }

  urdfStore.exporting = true
  urdfStore.exportProgress = '正在生成 URDF...'

  // ★ 修复3：保存并归零所有关节角度，确保以 bind pose 导出
  const savedValues = urdfStore.robot.joints.map(j => j.currentValue)
  urdfStore.robot.joints.forEach(j => { j.currentValue = 0 })

  try {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()

    // ★ 修复4：确保 FK 实例存在（防御性编程）
    const fk = forwardKinematics ?? new ForwardKinematics()
    fk.setRobot(urdfStore.robot)

    // 预计算所有 Link 的 restInverse（用于 STL 顶点变换 + URDF 惯性数据变换）
    const linkRestInverses = new Map<string, THREE.Matrix4>()
    for (const link of urdfStore.robot.links) {
      const rest = fk.getLinkRestTransform(link.id)
      if (rest) {
        // ★ 修复1：先 clone 再 invert，避免污染 FK 内部缓存
        linkRestInverses.set(link.id, rest.clone().invert())
      }
    }

    // 构建 base_link 坐标系位姿矩阵（position + RPY → 逆矩阵供序列化器变换子关节）
    let basePoseInverseForExport: THREE.Matrix4 | undefined
    const bOrigin = urdfStore.baseLinkOrigin
    const bRPY = urdfStore.baseLinkRPY
    if (bOrigin || bRPY) {
      const o = bOrigin ?? [0, 0, 0]
      const r = bRPY ?? [0, 0, 0]
      const T = new THREE.Matrix4().makeTranslation(o[0], o[1], o[2])
      // 使用 RPY 欧拉角构建旋转矩阵（ZYX 顺序，与 URDF rpy 约定一致，与 FrameVisualizer 完全一致）
      const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'ZYX'))
      const basePoseMatrix = new THREE.Matrix4().multiplyMatrices(T, R)
      basePoseInverseForExport = basePoseMatrix.clone().invert()
      // 以 base_link 真实位姿逆覆盖其 restInverse，确保顶点导出坐标正确
      linkRestInverses.set(urdfStore.BASE_LINK_ID, basePoseInverseForExport)
    }

    // 生成 URDF XML（传入 restInverse 以变换 inertial COM 到 Link 局部坐标，unitScale: mm→m）
    const urdfXml = serializeURDF(urdfStore.robot, {
      linkRestInverses,
      unitScale: 0.001,
      basePoseInverse: basePoseInverseForExport,
      baseLinkId: urdfStore.BASE_LINK_ID
    })
    zip.file('robot.urdf', urdfXml)

    // 为每个 Link 生成 STL（顶点从世界坐标变换到 Link 局部坐标）
    const links = urdfStore.robot.links.filter(l => l.solidIds.length > 0)
    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      urdfStore.exportProgress = `正在生成 ${link.name}.stl (${i + 1}/${links.length})...`
      // 让 UI 刷新
      await new Promise(r => setTimeout(r, 0))

      const solidDataList: import('../types').SerializedSolidData[] = []
      for (const solidId of link.solidIds) {
        const solid = store.solidMap.get(solidId)
        if (solid?.serializedData) solidDataList.push(solid.serializedData)
      }
      if (solidDataList.length > 0) {
        const restInverse = linkRestInverses.get(link.id)
        const stl = generateBinarySTL(solidDataList, restInverse, 0.001)
        zip.file(`meshes/${link.name}.stl`, stl)
      }
    }

    urdfStore.exportProgress = '正在打包 ZIP...'
    await new Promise(r => setTimeout(r, 0))

    const zipBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    // 下载
    const blob = new Blob([zipBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${urdfStore.robot.name}.zip`
    a.click()
    URL.revokeObjectURL(url)

    ElMessage.success('URDF 导出成功')
  } catch (err) {
    ElMessage.error(`导出失败: ${(err as Error).message}`)
  } finally {
    // ★ 修复3：始终恢复关节角度（即使导出失败）
    urdfStore.robot.joints.forEach((j, i) => { j.currentValue = savedValues[i] })
    updateFKAndFrames()
    urdfStore.exporting = false
    urdfStore.exportProgress = ''
  }
}

// ========== URDF Watchers ==========

// 深度监听关节所有属性变化（currentValue、origin、axis、limits 等），实时更新 FK
watch(
  () => urdfStore.robot.joints,
  () => {
    if (urdfStore.viewMode === 'urdf') {
      updateFKAndFrames()
    }
  },
  { deep: true }
)

// 监听显示坐标系切换
watch(() => urdfStore.showFrames, (val) => {
  frameVisualizer?.setVisible(val)
  sceneManager?.markDirty()
})

// 监听 link 结构变化（link 增删可能影响 FK 树）
watch(
  () => urdfStore.robot.links.length,
  () => {
    if (urdfStore.viewMode === 'urdf') {
      updateFKAndFrames()
    }
  }
)

// 监听 edgePickEditJointId：由右侧属性面板写入，驱动 StepViewer 进入/退出边拾取模式
watch(
  () => urdfStore.edgePickEditJointId,
  (id, oldId) => {
    if (id && !edgePickMode) {
      startEdgePickMode()
    } else if (!id && edgePickMode) {
      stopEdgePickMode()
    }
  }
)

// 监听坐标轴缩放比变化 → 重建所有 frame 可视化
watch(
  () => urdfStore.axisHelperScale,
  (scale) => {
    if (frameVisualizer && urdfStore.viewMode === 'urdf') {
      frameVisualizer.setAxisLength(baseAxisLength * scale)
      updateFKAndFrames()
    }
  }
)

// 监听 Base Origin 变化 → 刷新 Base Frame 可视化
watch(
  () => urdfStore.baseLinkOrigin,
  () => {
    if (frameVisualizer && urdfStore.viewMode === 'urdf') updateFKAndFrames()
  },
  { deep: true }
)

// 监听 Base Orientation 变化 → 刷新 Base Frame 朝向
watch(
  () => urdfStore.baseLinkRPY,
  () => {
    if (frameVisualizer && urdfStore.viewMode === 'urdf') updateFKAndFrames()
  },
  { deep: true }
)

// 监听绑定模式入場 → 高亮目标 Link 已绑定的所有 Solid
watch(
  () => urdfStore.bindingMode.active,
  (active) => {
    if (urdfStore.viewMode !== 'urdf' || !selectionManager) return
    isHighlightingFromWatcher = true
    try {
      selectionManager.clearSelection()
      if (active) {
        const linkId = urdfStore.bindingMode.targetLinkId
        if (linkId) {
          const link = urdfStore.linkMap.get(linkId)
          link?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
        }
      } else {
        // 绑定模式退出：恢复当前选中连杆的高亮
        if (urdfStore.selectedLinkId) {
          const link = urdfStore.linkMap.get(urdfStore.selectedLinkId)
          link?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
        }
      }
    } finally {
      isHighlightingFromWatcher = false
    }
    sceneManager?.markDirty()
  }
)

// 监听选中 Link 或 Joint 变化 → 原子地更新 3D 高亮（单一 watcher 避免两个独立 watcher 顺序执行导致互相覆盖）
watch(
  [() => urdfStore.selectedLinkId, () => urdfStore.selectedJointId] as const,
  ([linkId, jointId]) => {
    if (urdfStore.viewMode !== 'urdf' || !selectionManager) return
    // 绑定模式下已有专属高亮逻辑，不覆盖
    if (urdfStore.bindingMode.active) return
    isHighlightingFromWatcher = true
    try {
      selectionManager.clearSelection()
      if (linkId) {
        const link = urdfStore.linkMap.get(linkId)
        link?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
      } else if (jointId) {
        const joint = urdfStore.jointMap.get(jointId)
        if (joint) {
          const parentLink = urdfStore.linkMap.get(joint.parentLinkId)
          const childLink = urdfStore.linkMap.get(joint.childLinkId)
          parentLink?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
          childLink?.solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
        }
      }
    } finally {
      isHighlightingFromWatcher = false
    }
    sceneManager?.markDirty()
  }
)

// 暴露方法给父组件
defineExpose({
  fitView: handleFitView,
  clearSelection: handleClearSelection,
  clearMeasurements: handleClearMeasurements,
  loadFile: handleFileUpload
})
</script>

<style lang="scss" scoped>
.step-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #fff;
  overflow: hidden;
}

.viewer-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f5f5f5;

  :deep(canvas) {
    display: block;
  }
}

.empty-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(245, 245, 245, 0.95);
  z-index: 10;
}

.binding-overlay {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-text {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

.status-bar {
  padding: 3px 12px;
  font-size: 12px;
  color: #606266;
  background: #f5f5f5;
  border-top: 1px solid #e4e7ed;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
