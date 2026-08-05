import { defineStore } from "pinia";
import { ref, shallowRef, computed, markRaw } from "vue";
import * as THREE from "three";
import type { SolidObject, GeometryFeature, UploadProgress, TreeNode } from "../types";
import type { LineMeasurementData } from "../core/LineMeasurementTool";

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const useStepViewerStore = defineStore("stepViewer", () => {
  const uploadProgress = ref<UploadProgress>({
    status: "idle",
    progress: 0,
    message: "",
  });

  const solids = shallowRef<SolidObject[]>([]);
  const solidRevision = ref(0);
  const focusedSolidId = ref<string | null>(null);
  const modelRotationElements = ref<number[] | null>(null);
  const currentFileName = ref<string>("");

  const treeNodes = ref<TreeNode[]>([]);
  const selectedTreeNodeIds = ref<string[]>([]);
  const expandedTreeNodeIds = ref<string[]>([]);
  const treeNodeCount = ref(0);

  const sidePanelVisible = ref(true);
  const sidePanelWidth = ref(280);

  const selectedFeatures = ref<GeometryFeature[]>([]);

  const lineMeasurements = ref<LineMeasurementData[]>([]);
  const isLineMeasureActive = ref(false);

  const showAxes = ref(false);
  const showGrid = ref(true);
  const globalOpacity = ref(0.3);
  const isTransparent = ref(false);

  const solidVisibilityMap = ref(new Map<string, boolean>());

  const hasModel = computed(() => solids.value.length > 0);

  const isLoading = computed(
    () => uploadProgress.value.status === "uploading" || uploadProgress.value.status === "parsing",
  );

  const firstSelectedFeature = computed(() => selectedFeatures.value[0] || null);

  const secondSelectedFeature = computed(() => selectedFeatures.value[1] || null);

  const canMeasure = computed(() => selectedFeatures.value.length === 2);

  const featureStats = computed(() => {
    const stats: Record<string, number> = {};
    for (const solid of solids.value) {
      for (const feature of solid.features) {
        stats[feature.type] = (stats[feature.type] || 0) + 1;
      }
    }
    return stats;
  });

  const flatTreeNodeMap = computed(() => {
    const map = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children) walk(node.children);
      }
    };
    walk(treeNodes.value);
    return map;
  });

  const selectedTreeNodeIdSet = computed(() => new Set(selectedTreeNodeIds.value));

  const solidMap = computed(() => {
    const map = new Map<string, SolidObject>();
    for (const s of solids.value) map.set(s.id, s);
    return map;
  });

  const solidNameMap = computed(() => {
    void solidRevision.value;
    const map = new Map<string, string>();
    for (const s of solids.value) map.set(s.id, s.name);
    return map;
  });

  const selectedSolidNames = computed(() =>
    selectedTreeNodeIds.value
      .map((id) => flatTreeNodeMap.value.get(id)?.name)
      .filter((name): name is string => !!name),
  );

  function solidIdOfIndex(index: number | undefined): string | null {
    if (index === undefined) return null;
    const byConvention = `solid_${index}`;
    if (solidMap.value.has(byConvention)) return byConvention;
    return solids.value[index]?.id ?? null;
  }

  function solidIdOfNode(node: Pick<TreeNode, "id" | "type" | "solidIndex">): string | null {
    if (node.type !== "solid") return null;
    if (node.id && solidMap.value.has(node.id)) return node.id;
    return solidIdOfIndex(node.solidIndex);
  }

  const treeNodeIdBySolidId = computed(() => {
    const map = new Map<string, string>();
    for (const node of flatTreeNodeMap.value.values()) {
      if (node.type !== "solid") continue;
      const solidId = solidIdOfNode(node);
      if (solidId && !map.has(solidId)) map.set(solidId, node.id);
    }
    return map;
  });

  function treeNodeIdOfSolid(solidId: string): string {
    return treeNodeIdBySolidId.value.get(solidId) ?? solidId;
  }

  const selectedSolidIds = computed(() => {
    const ids: string[] = [];
    for (const nodeId of new Set(selectedTreeNodeIds.value)) {
      const node = flatTreeNodeMap.value.get(nodeId);
      const solidId = node ? solidIdOfNode(node) : solidMap.value.has(nodeId) ? nodeId : null;
      if (solidId && !ids.includes(solidId)) ids.push(solidId);
    }
    return ids;
  });

  const hasTreeSelection = computed(
    () => selectedTreeNodeIds.value.length > 0 || !!focusedSolidId.value,
  );

  function updateUploadProgress(progress: Partial<UploadProgress>): void {
    uploadProgress.value = { ...uploadProgress.value, ...progress };
  }

  function setSolids(newSolids: SolidObject[]): void {
    solids.value = newSolids.map((s) => markRaw(s));
    focusedSolidId.value = null;
    solidRevision.value++;
  }

  function setFocusedSolid(solidId: string | null): void {
    focusedSolidId.value = solidId;
  }

  function renameSolid(solidId: string, name: string): boolean {
    const trimmed = name.trim();
    const solid = solidMap.value.get(solidId);
    if (!solid || !trimmed || trimmed === solid.name) return false;

    solid.name = trimmed;
    if (solid.instanceId === undefined) solid.mesh.name = trimmed;
    if (solid.serializedData) solid.serializedData.name = trimmed;

    const node = flatTreeNodeMap.value.get(treeNodeIdOfSolid(solidId));
    if (node) node.name = trimmed;
    treeNodes.value = [...treeNodes.value];
    solidRevision.value++;
    return true;
  }

  function getModelRotation(): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    if (modelRotationElements.value) m.fromArray(modelRotationElements.value);
    return m;
  }

  function setModelRotation(m: THREE.Matrix4): void {
    modelRotationElements.value = m.toArray();
  }

  const isModelRotated = computed(() => {
    const e = modelRotationElements.value;
    if (!e) return false;
    return e.some((v, i) => Math.abs(v - IDENTITY_MATRIX[i]) > 1e-12);
  });

  function setTreeNodes(nodes: TreeNode[]): void {
    treeNodes.value = nodes;
    const idsToExpand: string[] = [];
    let count = 0;
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        count++;
        if (n.type === "root" || n.type === "compound") {
          idsToExpand.push(n.id);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    expandedTreeNodeIds.value = idsToExpand;
    treeNodeCount.value = count;
  }

  function selectTreeNode(nodeId: string, multi = false): void {
    if (multi) {
      const idx = selectedTreeNodeIds.value.indexOf(nodeId);
      if (idx >= 0) {
        selectedTreeNodeIds.value.splice(idx, 1);
      } else {
        selectedTreeNodeIds.value.push(nodeId);
      }
    } else {
      selectedTreeNodeIds.value = [nodeId];
    }
  }

  function syncTreeFromSelection(treeNodeIds: string[]): void {
    selectedTreeNodeIds.value = [...treeNodeIds];
  }

  function clearTreeSelection(): void {
    selectedTreeNodeIds.value = [];
  }

  function setFileName(name: string): void {
    currentFileName.value = name;
  }

  function clearModel(): void {
    solids.value = [];
    focusedSolidId.value = null;
    modelRotationElements.value = null;
    currentFileName.value = "";
    selectedFeatures.value = [];
    lineMeasurements.value = [];
    isLineMeasureActive.value = false;
    isTransparent.value = false;
    treeNodes.value = [];
    selectedTreeNodeIds.value = [];
    expandedTreeNodeIds.value = [];
    solidVisibilityMap.value = new Map();
    uploadProgress.value = {
      status: "idle",
      progress: 0,
      message: "",
    };
  }

  function setSelectedFeatures(features: GeometryFeature[]): void {
    selectedFeatures.value = features;
  }

  function clearSelection(): void {
    selectedFeatures.value = [];
    selectedTreeNodeIds.value = [];
    focusedSolidId.value = null;
  }

  function addLineMeasurement(line: LineMeasurementData): void {
    lineMeasurements.value.push(line);
  }

  function removeLineMeasurement(id: string): void {
    const idx = lineMeasurements.value.findIndex((l) => l.id === id);
    if (idx > -1) lineMeasurements.value.splice(idx, 1);
  }

  function clearLineMeasurements(): void {
    lineMeasurements.value = [];
  }

  function setLineMeasureActive(active: boolean): void {
    isLineMeasureActive.value = active;
  }

  function toggleSolidVisibility(solidId: string): void {
    const current = solidVisibilityMap.value.get(solidId) ?? true;
    solidVisibilityMap.value.set(solidId, !current);
    solidVisibilityMap.value = new Map(solidVisibilityMap.value);
  }

  function isSolidVisible(solidId: string): boolean {
    return solidVisibilityMap.value.get(solidId) ?? true;
  }

  function toggleSidePanel(): void {
    sidePanelVisible.value = !sidePanelVisible.value;
  }

  function setSidePanelWidth(width: number): void {
    sidePanelWidth.value = Math.max(120, Math.min(500, width));
  }

  function setShowAxes(show: boolean): void {
    showAxes.value = show;
  }

  function setShowGrid(show: boolean): void {
    showGrid.value = show;
  }

  function setGlobalOpacity(opacity: number): void {
    globalOpacity.value = opacity;
  }

  function setTransparent(value: boolean): void {
    isTransparent.value = value;
  }

  return {
    uploadProgress,
    solids,
    currentFileName,
    treeNodes,
    selectedTreeNodeIds,
    expandedTreeNodeIds,
    sidePanelVisible,
    sidePanelWidth,
    selectedFeatures,
    lineMeasurements,
    isLineMeasureActive,
    showAxes,
    showGrid,
    globalOpacity,
    isTransparent,
    solidVisibilityMap,
    modelRotationElements,
    focusedSolidId,

    hasModel,
    isLoading,
    firstSelectedFeature,
    secondSelectedFeature,
    canMeasure,
    featureStats,
    flatTreeNodeMap,
    selectedTreeNodeIdSet,
    selectedSolidNames,
    selectedSolidIds,
    hasTreeSelection,
    solidMap,
    solidNameMap,
    treeNodeCount,
    isModelRotated,

    solidIdOfNode,
    solidIdOfIndex,
    treeNodeIdOfSolid,
    updateUploadProgress,
    setSolids,
    setFocusedSolid,
    renameSolid,
    getModelRotation,
    setModelRotation,
    setFileName,
    setTreeNodes,
    selectTreeNode,
    syncTreeFromSelection,
    clearTreeSelection,
    clearModel,
    setSelectedFeatures,
    clearSelection,
    addLineMeasurement,
    removeLineMeasurement,
    clearLineMeasurements,
    setLineMeasureActive,
    toggleSolidVisibility,
    isSolidVisible,
    toggleSidePanel,
    setSidePanelWidth,
    setShowAxes,
    setShowGrid,
    setGlobalOpacity,
    setTransparent,
  };
});
