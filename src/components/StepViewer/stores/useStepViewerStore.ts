/**
 * STEP Viewer 状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  SolidObject,
  GeometryFeature,
  SelectionInfo,
  MeasurementResult,
  UploadProgress,
  TreeNode,
  GranularityMode
} from '../types'
import type { LineMeasurementData } from '../core/LineMeasurementTool'
import { FeatureType } from '../types'

export const useStepViewerStore = defineStore('stepViewer', () => {
  // ============ 状态 ============

  // 上传状态
  const uploadProgress = ref<UploadProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  })

  // 模型数据
  const solids = ref<SolidObject[]>([])
  const currentFileName = ref<string>('')

  // 结构树状态
  const treeNodes = ref<TreeNode[]>([])
  const selectedTreeNodeIds = ref<string[]>([])
  const expandedTreeNodeIds = ref<string[]>([])
  const treeNodeCount = ref(0)

  // 侧栏状态
  const sidePanelVisible = ref(true)
  const sidePanelWidth = ref(280)

  // 选择状态
  const selectedFeatures = ref<GeometryFeature[]>([])

  // 测量状态
  const measurements = ref<MeasurementResult[]>([])

  // 画线测量状态
  const lineMeasurements = ref<LineMeasurementData[]>([])
  const isLineMeasureActive = ref(false)

  // 显示设置
  const showAxes = ref(false)
  const showGrid = ref(true)
  const globalOpacity = ref(0.3)
  const isTransparent = ref(false)

  // 选择粒度模式
  const granularityMode = ref<GranularityMode>('solid')

  // ============ 计算属性 ============

  // 是否已加载模型
  const hasModel = computed(() => solids.value.length > 0)

  // 是否正在加载
  const isLoading = computed(() =>
    uploadProgress.value.status === 'uploading' ||
    uploadProgress.value.status === 'parsing'
  )

  // 选中的第一个特征
  const firstSelectedFeature = computed(() => selectedFeatures.value[0] || null)

  // 选中的第二个特征
  const secondSelectedFeature = computed(() => selectedFeatures.value[1] || null)

  // 是否可以测量（选中两个特征）
  const canMeasure = computed(() => selectedFeatures.value.length === 2)

  // 获取需要显示法向线的选中特征（仅边模式下显示）
  const featuresWithNormalLine = computed(() => {
    if (granularityMode.value !== 'edge') return []
    return selectedFeatures.value.filter(f =>
      [FeatureType.CIRCLE, FeatureType.ARC, FeatureType.CYLINDER].includes(f.type) ||
      (f.edgeIndex !== undefined && f.edgeCurveType === 'circle')
    )
  })

  // 所有特征的类型统计
  const featureStats = computed(() => {
    const stats: Record<string, number> = {}
    solids.value.forEach(solid => {
      solid.features.forEach(feature => {
        const type = feature.type
        stats[type] = (stats[type] || 0) + 1
      })
    })
    return stats
  })

  /** 扁平化树节点（用于快速查找） */
  const flatTreeNodes = computed(() => {
    const result: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        result.push(node)
        if (node.children) walk(node.children)
      }
    }
    walk(treeNodes.value)
    return result
  })

  /** 选中节点 ID 的 Set（O(1) 查找） */
  const selectedTreeNodeIdSet = computed(() => new Set(selectedTreeNodeIds.value))

  /** Solid ID → SolidObject 映射（O(1) 查找，修复数组索引查找错位问题） */
  const solidMap = computed(() => {
    const map = new Map<string, SolidObject>()
    solids.value.forEach(s => map.set(s.id, s))
    return map
  })

  /** 选中的 Solid 名称列表 */
  const selectedSolidNames = computed(() => {
    return selectedTreeNodeIds.value
      .map(id => flatTreeNodes.value.find(n => n.id === id))
      .filter(Boolean)
      .map(n => n!.name)
  })

  // ============ 动作 ============

  /**
   * 更新上传进度
   */
  function updateUploadProgress(progress: Partial<UploadProgress>): void {
    uploadProgress.value = { ...uploadProgress.value, ...progress }
  }

  /**
   * 设置模型数据
   */
  function setSolids(newSolids: SolidObject[]): void {
    solids.value = newSolids
  }

  /**
   * 设置结构树节点
   */
  function setTreeNodes(nodes: TreeNode[]): void {
    treeNodes.value = nodes
    // 默认只展开根层和 Compound 层
    const idsToExpand: string[] = []
    let count = 0
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        count++
        if (n.type === 'root' || n.type === 'compound') {
          idsToExpand.push(n.id)
        }
        if (n.children) walk(n.children)
      }
    }
    walk(nodes)
    expandedTreeNodeIds.value = idsToExpand
    treeNodeCount.value = count
  }

  /**
   * 选中树节点（来自树的交互）
   */
  function selectTreeNode(nodeId: string, multi = false): void {
    if (multi) {
      const idx = selectedTreeNodeIds.value.indexOf(nodeId)
      if (idx >= 0) {
        selectedTreeNodeIds.value.splice(idx, 1)
      } else {
        selectedTreeNodeIds.value.push(nodeId)
      }
    } else {
      selectedTreeNodeIds.value = [nodeId]
    }
  }

  /**
   * 从 3D 选中同步到树（3D→树方向）
   */
  function syncTreeFromSelection(treeNodeIds: string[]): void {
    selectedTreeNodeIds.value = [...treeNodeIds]
  }

  /**
   * 清空树选择
   */
  function clearTreeSelection(): void {
    selectedTreeNodeIds.value = []
  }

  /**
   * 设置当前文件名
   */
  function setFileName(name: string): void {
    currentFileName.value = name
  }

  /**
   * 清空模型
   */
  function clearModel(): void {
    solids.value = []
    currentFileName.value = ''
    selectedFeatures.value = []
    measurements.value = []
    lineMeasurements.value = []
    isLineMeasureActive.value = false
    isTransparent.value = false
    treeNodes.value = []
    selectedTreeNodeIds.value = []
    expandedTreeNodeIds.value = []
    uploadProgress.value = {
      status: 'idle',
      progress: 0,
      message: ''
    }
  }

  /**
   * 设置选中的特征
   */
  function setSelectedFeatures(features: GeometryFeature[]): void {
    selectedFeatures.value = features
  }

  /**
   * 添加选中的特征
   */
  function addSelectedFeature(feature: GeometryFeature): void {
    if (!selectedFeatures.value.find(f => f.id === feature.id)) {
      selectedFeatures.value.push(feature)
    }
  }

  /**
   * 移除选中的特征
   */
  function removeSelectedFeature(featureId: string): void {
    const index = selectedFeatures.value.findIndex(f => f.id === featureId)
    if (index > -1) {
      selectedFeatures.value.splice(index, 1)
    }
  }

  /**
   * 清空选择
   */
  function clearSelection(): void {
    selectedFeatures.value = []
    selectedTreeNodeIds.value = []
  }

  /**
   * 添加测量结果
   */
  function addMeasurement(result: MeasurementResult): void {
    measurements.value.push(result)
  }

  /**
   * 移除测量结果
   */
  function removeMeasurement(id: string): void {
    const index = measurements.value.findIndex(m => m.id === id)
    if (index > -1) {
      measurements.value.splice(index, 1)
    }
  }

  /**
   * 清空所有测量
   */
  function clearMeasurements(): void {
    measurements.value = []
  }

  // ========== 画线测量 ==========

  function addLineMeasurement(line: LineMeasurementData): void {
    lineMeasurements.value.push(line)
  }

  function removeLineMeasurement(id: string): void {
    const idx = lineMeasurements.value.findIndex(l => l.id === id)
    if (idx > -1) lineMeasurements.value.splice(idx, 1)
  }

  function clearLineMeasurements(): void {
    lineMeasurements.value = []
  }

  function setLineMeasureActive(active: boolean): void {
    isLineMeasureActive.value = active
  }


  /**
   * 切换侧栏可见性
   */
  function toggleSidePanel(): void {
    sidePanelVisible.value = !sidePanelVisible.value
  }

  /**
   * 设置侧栏宽度
   */
  function setSidePanelWidth(width: number): void {
    sidePanelWidth.value = Math.max(120, Math.min(500, width))
  }

  /**
   * 设置显示设置
   */
  function setShowAxes(show: boolean): void {
    showAxes.value = show
  }

  function setShowGrid(show: boolean): void {
    showGrid.value = show
  }

  /**
   * 设置选择粒度模式
   */
  function setGranularityMode(mode: GranularityMode): void {
    granularityMode.value = mode
  }

  /**
   * 设置全局透明度
   */
  function setGlobalOpacity(opacity: number): void {
    globalOpacity.value = opacity
  }

  /**
   * 设置透明模式
   */
  function setTransparent(value: boolean): void {
    isTransparent.value = value
  }

  /**
   * 切换透明模式
   */
  function toggleTransparent(): boolean {
    isTransparent.value = !isTransparent.value
    return isTransparent.value
  }

  /**
   * 设置单个 Solid 的透明度
   */
  function setSolidOpacity(solidId: string, opacity: number): void {
    const solid = solids.value.find(s => s.id === solidId)
    if (solid) {
      solid.opacity = opacity
    }
  }

  /**
   * 设置 Solid 可见性
   */
  function setSolidVisibility(solidId: string, visible: boolean): void {
    const solid = solids.value.find(s => s.id === solidId)
    if (solid) {
      solid.visible = visible
    }
  }

  /**
   * 查找 Solid
   */
  function findSolid(id: string): SolidObject | undefined {
    return solids.value.find(s => s.id === id)
  }

  /**
   * 查找特征
   */
  function findFeature(featureId: string): GeometryFeature | undefined {
    for (const solid of solids.value) {
      const feature = solid.features.find(f => f.id === featureId)
      if (feature) return feature
      const edgeFeature = solid.edgeFeatures.find(f => f.id === featureId)
      if (edgeFeature) return edgeFeature
    }
    return undefined
  }

  return {
    // 状态
    uploadProgress,
    solids,
    currentFileName,
    treeNodes,
    selectedTreeNodeIds,
    expandedTreeNodeIds,
    sidePanelVisible,
    sidePanelWidth,
    selectedFeatures,
    measurements,
    lineMeasurements,
    isLineMeasureActive,
    showAxes,
    showGrid,
    globalOpacity,
    isTransparent,
    granularityMode,

    // 计算属性
    hasModel,
    isLoading,
    firstSelectedFeature,
    secondSelectedFeature,
    canMeasure,
    featuresWithNormalLine,
    featureStats,
    flatTreeNodes,
    selectedTreeNodeIdSet,
    selectedSolidNames,
    solidMap,
    treeNodeCount,

    // 动作
    updateUploadProgress,
    setSolids,
    setFileName,
    setTreeNodes,
    selectTreeNode,
    syncTreeFromSelection,
    clearTreeSelection,
    clearModel,
    setSelectedFeatures,
    addSelectedFeature,
    removeSelectedFeature,
    clearSelection,
    addMeasurement,
    removeMeasurement,
    clearMeasurements,
    addLineMeasurement,
    removeLineMeasurement,
    clearLineMeasurements,
    setLineMeasureActive,
    toggleSidePanel,
    setSidePanelWidth,
    setShowAxes,
    setShowGrid,
    setGranularityMode,
    setGlobalOpacity,
    setTransparent,
    toggleTransparent,
    setSolidOpacity,
    setSolidVisibility,
    findSolid,
    findFeature
  }
})
