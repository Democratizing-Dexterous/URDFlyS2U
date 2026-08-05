import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FeatureType } from "../types";
import type { GeometryFeature, SolidObject, SelectionInfo, GranularityMode } from "../types";

const AXIS_PICK_FACE_TYPES = new Set<FeatureType>([
  FeatureType.CYLINDER,
  FeatureType.CONE,
  FeatureType.ARC,
  FeatureType.TORUS,
]);

function projectPointOnAxis(
  point: THREE.Vector3,
  axisPoint: THREE.Vector3,
  axisDir: THREE.Vector3,
): THREE.Vector3 {
  const dir = axisDir.clone().normalize();
  const d = point.clone().sub(axisPoint);
  return axisPoint.clone().addScaledVector(dir, d.dot(dir));
}

function rafThrottle<T extends (...args: never[]) => void>(fn: T): T & { cancel: () => void } {
  let rafId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = function (...args: Parameters<T>) {
    lastArgs = args;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (lastArgs) {
          fn(...lastArgs);
          lastArgs = null;
        }
      });
    }
  } as T & { cancel: () => void };

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastArgs = null;
  };

  return throttled;
}

export interface SelectionManagerConfig {
  camera: THREE.Camera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  controls?: OrbitControls;
  highlightColor?: number;
  selectionColor?: number;
  onRenderRequest?: () => void;
}

export interface SelectionEvent {
  selections: SelectionInfo[];
  added?: SelectionInfo;
  removed?: SelectionInfo;
  selectedTreeNodeIds?: string[];
}

export interface AxisPickCandidate {
  solid: SolidObject;
  feature: GeometryFeature;
  edgeIndex: number;
  kind: "edge" | "face";
  distance: number;
  description: string;
}

export interface AxisCandidateInfo {
  index: number;
  total: number;
  description: string;
}

export class SelectionManager {
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private domElement: HTMLElement;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private highlightColor: number;
  private selectionColor: number;

  private solids: SolidObject[] = [];
  private selectedSolids: Set<string> = new Set();
  private selectedFeatures: Map<string, GeometryFeature> = new Map();
  private enabled = true;

  private selectionMode: "single" | "multi" = "single";

  private faceHighlightOverlays: Map<string, THREE.Mesh> = new Map();
  private faceHighlightMaterial!: THREE.MeshStandardMaterial;

  private edgeHighlightOverlays: Map<string, THREE.LineSegments> = new Map();
  private edgeHighlightMaterial!: THREE.LineBasicMaterial;
  private hoverEdgeMaterial!: THREE.LineBasicMaterial;
  private selectedEdgeMaterial!: THREE.LineBasicMaterial;
  private hoverEdgeOverlay: THREE.LineSegments | null = null;

  private granularityMode: GranularityMode = "solid";
  private edgeRaycaster: THREE.Raycaster;
  private axisRaycaster: THREE.Raycaster;
  private axisCandidates: AxisPickCandidate[] = [];
  private axisCandidateIndex = 0;
  private lastAxisPickEvent: { clientX: number; clientY: number } | null = null;
  private onAxisCandidatesCallback?: (info: AxisCandidateInfo) => void;

  private hoveredFeature: GeometryFeature | null = null;
  private hoveredMesh: THREE.Mesh | null = null;
  private hoveredBrepFaceIndex: number = -1;
  private hoveredSolid: SolidObject | null = null;

  private highlightMaterials: Map<string, THREE.MeshStandardMaterial> = new Map();
  private originalMaterials: Map<string, THREE.Material | THREE.Material[]> = new Map();

  private originalInstanceColors: Map<string, THREE.Color> = new Map();
  private instancedMeshRefs: Map<string, THREE.InstancedMesh> = new Map();

  private onSelectCallback?: (event: SelectionEvent) => void;
  private onSolidActivateCallback?: (solidId: string, multi: boolean) => void;
  private onHoverCallback?: (feature: GeometryFeature | null) => void;
  private onRenderRequest?: () => void;

  private static readonly EDGE_DEFAULT_COLOR = 0x333333;
  private static readonly EDGE_HOVER_COLOR = 0xffdd00;
  private static readonly EDGE_SELECTED_COLOR = 0xff4400;
  private static readonly EDGE_DEFAULT_OPACITY = 0.6;
  private static readonly EDGE_HIGHLIGHT_OPACITY = 1.0;

  private rafThrottledMouseMove: ((event: MouseEvent) => void) & { cancel: () => void };
  private isDragging = false;

  private pointerMoved = false;

  private orbitHappened = false;
  private mouseDownPos = { x: 0, y: 0 };
  private readonly DRAG_THRESHOLD = 5;
  private lastHoverX = 0;
  private lastHoverY = 0;
  private readonly HOVER_PIXEL_THRESHOLD_SQ = 9;

  private orbitControls: OrbitControls | null = null;
  private isOrbitActive = false;

  private cachedRect: DOMRect | null = null;
  private cachedMeshes: THREE.Mesh[] = [];
  private featureIndexMap: Map<string, Map<number, GeometryFeature>> = new Map();
  private edgeIndexMap: Map<string, Map<number, GeometryFeature>> = new Map();
  private cachedTopologyEdges: THREE.LineSegments[] = [];
  private meshToSolid: Map<THREE.Mesh, SolidObject> = new Map();
  private solidIdMap: Map<string, SolidObject> = new Map();
  private instancedMeshToSolids: Map<string, Map<number, SolidObject>> = new Map();
  private resizeObserver: ResizeObserver | null = null;

  constructor(config: SelectionManagerConfig) {
    this.camera = config.camera;
    this.scene = config.scene;
    this.domElement = config.domElement;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onRenderRequest = config.onRenderRequest;

    this.raycaster.params.Line = { threshold: 1 };
    this.raycaster.params.Points = { threshold: 1 };
    (this.raycaster as THREE.Raycaster & { firstHitOnly: boolean }).firstHitOnly = true;

    this.highlightColor = config.highlightColor ?? 0x00ff00;
    this.selectionColor = config.selectionColor ?? 0xff8800;

    this.rafThrottledMouseMove = rafThrottle(this.performHoverCheck.bind(this));

    this.edgeRaycaster = new THREE.Raycaster();
    this.edgeRaycaster.params.Line = { threshold: 2 };

    this.axisRaycaster = new THREE.Raycaster();
    this.axisRaycaster.params.Line = { threshold: 2 };

    this.updateCachedRect();

    this.resizeObserver = new ResizeObserver(() => {
      this.updateCachedRect();
    });
    this.resizeObserver.observe(this.domElement);

    this.faceHighlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: 0xff6600,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.edgeHighlightMaterial = new THREE.LineBasicMaterial({
      color: 0xff6600,
      linewidth: 2,
      transparent: false,
      depthTest: true,
    });

    this.hoverEdgeMaterial = new THREE.LineBasicMaterial({
      color: SelectionManager.EDGE_HOVER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 1,
    });

    this.selectedEdgeMaterial = new THREE.LineBasicMaterial({
      color: SelectionManager.EDGE_SELECTED_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 1,
    });

    this.orbitControls = config.controls ?? null;
    if (this.orbitControls) {
      this.orbitControls.addEventListener("start", this.handleOrbitStart);
      this.orbitControls.addEventListener("end", this.handleOrbitEnd);
    }

    this.domElement.addEventListener("click", this.handleClick);
    this.domElement.addEventListener("dblclick", this.handleDoubleClick);
    this.domElement.addEventListener("mousemove", this.handleMouseMove);
    this.domElement.addEventListener("mousedown", this.handleMouseDown);
    this.domElement.addEventListener("mouseup", this.handleMouseUp);
    this.domElement.addEventListener("mouseleave", this.handleMouseLeave);
    this.domElement.addEventListener("contextmenu", this.handleContextMenu);
  }

  private updateCachedRect(): void {
    this.cachedRect = this.domElement.getBoundingClientRect();
  }

  private handleOrbitStart = (): void => {
    this.isOrbitActive = true;
    if (this.hoveredFeature && !this.selectedFeatures.has(this.hoveredFeature.id)) {
      this.clearHoverHighlight();
    }
  };

  private handleOrbitEnd = (): void => {
    this.isOrbitActive = false;
    this.orbitHappened = true;
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.isDragging && this.exceedsDragThreshold(event)) {
      this.pointerMoved = true;
      return;
    }
    if (this.isOrbitActive) return;
    this.rafThrottledMouseMove(event);
  };

  private performHoverCheck(event: MouseEvent): void {
    if (this.isOrbitActive || this.isDragging) return;

    const hdx = event.clientX - this.lastHoverX;
    const hdy = event.clientY - this.lastHoverY;
    if (hdx * hdx + hdy * hdy < this.HOVER_PIXEL_THRESHOLD_SQ) return;
    this.lastHoverX = event.clientX;
    this.lastHoverY = event.clientY;

    if (this.granularityMode === "edge") {
      this.performEdgeHoverCheck(event);
      return;
    }

    const intersects = this.getIntersects(event);

    if (intersects.length === 0) {
      this.resetHoverState();
      return;
    }

    const intersection = intersects[0];
    const mesh = intersection.object as THREE.Mesh;

    const currentBrepFaceIndex = this.getBrepFaceIndex(mesh, intersection);
    if (mesh === this.hoveredMesh && currentBrepFaceIndex === this.hoveredBrepFaceIndex) return;

    const solid = this.findSolidFromIntersection(intersection);
    if (!solid) {
      this.resetHoverState();
      return;
    }

    this.clearHoverHighlight();

    const feature = this.findFeatureAtPoint(solid, intersection);

    if (feature && !this.selectedFeatures.has(feature.id)) {
      this.applyHoverHighlight(mesh, solid);
    }

    this.hoveredFeature = feature;
    this.hoveredMesh = mesh;
    this.hoveredSolid = solid;
    this.hoveredBrepFaceIndex = currentBrepFaceIndex;
    this.onRenderRequest?.();
  }

  private resetHoverState(): void {
    if (!this.hoveredFeature && !this.hoveredSolid && !this.hoveredMesh) return;
    this.clearHoverHighlight();
    this.hoveredFeature = null;
    this.hoveredMesh = null;
    this.hoveredSolid = null;
    this.hoveredBrepFaceIndex = -1;
    this.onRenderRequest?.();
  }

  private getBrepFaceIndex(mesh: THREE.Mesh, intersection: THREE.Intersection): number {
    const faceIdx = intersection.faceIndex;
    if (faceIdx === undefined || faceIdx === null) return -1;

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const faceIndexAttr = geometry.getAttribute("faceIndex");
    if (!faceIndexAttr) return -1;

    const index = geometry.getIndex();
    let vertexIndex: number;
    if (index) {
      vertexIndex = index.getX(faceIdx * 3);
    } else {
      vertexIndex = faceIdx * 3;
    }
    return Math.floor(faceIndexAttr.getX(vertexIndex));
  }

  private applyHoverHighlight(_mesh: THREE.Mesh, solid: SolidObject): void {
    this.hoverSolidEdgeLines(solid, true);
  }

  private clearHoverHighlight(): void {
    if (this.hoveredSolid) {
      this.hoverSolidEdgeLines(this.hoveredSolid, false);
      if (this.granularityMode === "edge" && this.hoveredBrepFaceIndex >= 0) {
        if (this.hoveredFeature && !this.selectedFeatures.has(this.hoveredFeature.id)) {
          this.setTopologyEdgeColor(this.hoveredSolid, this.hoveredBrepFaceIndex, 0x444444);
        }
      }
    }
    this.removeHoverEdgeOverlay();
  }

  private createHoverEdgeOverlay(solid: SolidObject, edgeIndex: number): void {
    this.removeHoverEdgeOverlay();
    const geo = this.buildEdgeOverlayGeometry(solid, edgeIndex);
    if (!geo) return;

    this.hoverEdgeOverlay = new THREE.LineSegments(geo, this.hoverEdgeMaterial);
    this.hoverEdgeOverlay.renderOrder = 998;
    this.hoverEdgeOverlay.matrixAutoUpdate = false;
    this.hoverEdgeOverlay.matrix.copy(solid.topologyEdges!.matrixWorld);
    this.scene.add(this.hoverEdgeOverlay);
  }

  private buildEdgeOverlayGeometry(
    solid: SolidObject,
    edgeIndex: number,
  ): THREE.BufferGeometry | null {
    if (!solid.topologyEdges) return null;

    const srcGeo = solid.topologyEdges.geometry;
    const edgeIndexAttr = srcGeo.getAttribute("edgeIndex") as THREE.BufferAttribute;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;
    if (!edgeIndexAttr || !posAttr) return null;

    let count = 0;
    for (let i = 0; i < edgeIndexAttr.count; i++) {
      if (Math.floor(edgeIndexAttr.getX(i)) === edgeIndex) count++;
    }
    if (count === 0) return null;

    const positions = new Float32Array(count * 3);
    let o = 0;
    for (let i = 0; i < edgeIndexAttr.count; i++) {
      if (Math.floor(edgeIndexAttr.getX(i)) !== edgeIndex) continue;
      positions[o++] = posAttr.getX(i);
      positions[o++] = posAttr.getY(i);
      positions[o++] = posAttr.getZ(i);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }

  private removeHoverEdgeOverlay(): void {
    if (this.hoverEdgeOverlay) {
      this.scene.remove(this.hoverEdgeOverlay);
      this.hoverEdgeOverlay.geometry.dispose();
      this.hoverEdgeOverlay = null;
    }
  }

  private hoverSolidEdgeLines(solid: SolidObject, hover: boolean): void {
    if (!solid.edgeLines) return;
    if (solid.selected) return;

    if (solid.edgeVertexRange) {
      this.setEdgeVertexColors(
        solid.edgeLines,
        solid.edgeVertexRange,
        hover ? SelectionManager.EDGE_HOVER_COLOR : SelectionManager.EDGE_DEFAULT_COLOR,
      );
    } else {
      const material = solid.edgeLines.material as THREE.LineBasicMaterial;
      if (hover) {
        material.color.setHex(SelectionManager.EDGE_HOVER_COLOR);
        material.opacity = SelectionManager.EDGE_HIGHLIGHT_OPACITY;
      } else {
        material.color.setHex(SelectionManager.EDGE_DEFAULT_COLOR);
        material.opacity = SelectionManager.EDGE_DEFAULT_OPACITY;
      }
      material.needsUpdate = true;
    }
  }

  private exceedsDragThreshold(event: MouseEvent): boolean {
    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    return dx * dx + dy * dy > this.DRAG_THRESHOLD * this.DRAG_THRESHOLD;
  }

  private handleMouseUp = (event: MouseEvent): void => {
    if (this.isDragging && this.exceedsDragThreshold(event)) {
      this.pointerMoved = true;
    }
    this.isDragging = false;
  };

  suppressNextClick(): void {
    this.pointerMoved = true;
  }

  private consumeSuppressedClick(): boolean {
    const suppressed = this.pointerMoved || this.orbitHappened;
    this.pointerMoved = false;
    this.orbitHappened = false;
    return suppressed;
  }

  private handleMouseLeave = (): void => {
    this.isDragging = false;
    this.pointerMoved = false;
    this.orbitHappened = false;
    this.rafThrottledMouseMove.cancel();
    if (this.hoveredFeature) {
      this.clearHoverHighlight();
      this.hoveredFeature = null;
      this.hoveredMesh = null;
      this.hoveredSolid = null;
      this.hoveredBrepFaceIndex = -1;
      this.onRenderRequest?.();
    }
  };

  setSolids(solids: SolidObject[]): void {
    this.clearSelectionInternal();
    this.resetHoverState();
    this.highlightMaterials.forEach((mat) => mat.dispose());
    this.highlightMaterials.clear();
    this.originalMaterials.clear();

    this.solids = solids;

    this.meshToSolid.clear();
    this.solidIdMap.clear();
    this.instancedMeshToSolids.clear();
    this.instancedMeshRefs.clear();

    solids.forEach((solid) => {
      this.solidIdMap.set(solid.id, solid);
      if (solid.instanceId !== undefined && solid.mesh instanceof THREE.InstancedMesh) {
        const uuid = solid.mesh.uuid;
        if (!this.instancedMeshToSolids.has(uuid)) {
          this.instancedMeshToSolids.set(uuid, new Map());
        }
        this.instancedMeshToSolids.get(uuid)!.set(solid.instanceId, solid);
        this.instancedMeshRefs.set(uuid, solid.mesh as unknown as THREE.InstancedMesh);
      } else {
        this.meshToSolid.set(solid.mesh, solid);
      }
    });

    this.updateCachedMeshes();
    this.updateCachedTopologyEdges();
    this.buildFeatureIndexMap();
  }

  private updateCachedTopologyEdges(): void {
    const edgeSet = new Set<THREE.LineSegments>();
    this.solids.forEach((s) => {
      if (s.visible && s.topologyEdges) edgeSet.add(s.topologyEdges);
    });
    this.cachedTopologyEdges = Array.from(edgeSet);
  }

  private updateCachedMeshes(): void {
    const meshSet = new Set<THREE.Mesh>();
    this.solids.forEach((s) => {
      if (s.visible) meshSet.add(s.mesh);
    });
    this.cachedMeshes = Array.from(meshSet);
  }

  private buildFeatureIndexMap(): void {
    this.featureIndexMap.clear();
    this.edgeIndexMap.clear();
    this.solids.forEach((solid) => {
      const featureMap = new Map<number, GeometryFeature>();
      solid.features.forEach((feature) => {
        if (feature.faceIndex !== undefined) {
          featureMap.set(feature.faceIndex, feature);
        }
      });
      this.featureIndexMap.set(solid.id, featureMap);

      const edgeMap = new Map<number, GeometryFeature>();
      solid.edgeFeatures.forEach((feature) => {
        if (feature.edgeIndex !== undefined) {
          edgeMap.set(feature.edgeIndex, feature);
        }
      });
      this.edgeIndexMap.set(solid.id, edgeMap);
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.resetHoverState();
  }

  setSelectionMode(mode: "single" | "multi"): void {
    this.selectionMode = String(mode) === "multi" ? "multi" : "single";
  }

  onSolidActivate(callback: (solidId: string, multi: boolean) => void): void {
    this.onSolidActivateCallback = callback;
  }

  onSelect(callback: (event: SelectionEvent) => void): void {
    this.onSelectCallback = callback;
  }

  onHover(callback: (feature: GeometryFeature | null) => void): void {
    this.onHoverCallback = callback;
  }

  private handleClick = (event: MouseEvent): void => {
    const suppressed = this.consumeSuppressedClick();
    if (!this.enabled) return;
    if (suppressed) return;

    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > this.DRAG_THRESHOLD) {
      return;
    }

    if (this.granularityMode === "edge") {
      this.handleEdgeClick(event);
      return;
    }

    const intersects = this.getIntersects(event);

    if (intersects.length === 0) {
      return;
    }

    const intersection = intersects[0];

    const solid = this.findSolidFromIntersection(intersection);
    if (!solid) return;

    const feature = this.findFeatureAtPoint(solid, intersection);
    if (!feature) return;

    this.handleSelection(feature, solid, intersection, event);
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.granularityMode === "edge") return;

    const intersects = this.getIntersects(event);
    if (intersects.length === 0) return;

    const solid = this.findSolidFromIntersection(intersects[0]);
    if (!solid) return;

    this.onSolidActivateCallback?.(solid.id, event.ctrlKey || event.shiftKey);
  };

  private handleMouseDown = (event: MouseEvent): void => {
    this.mouseDownPos.x = event.clientX;
    this.mouseDownPos.y = event.clientY;
    this.isDragging = true;
    this.pointerMoved = false;
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private getIntersects(event: MouseEvent): THREE.Intersection[] {
    const rect = this.cachedRect || this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    return this.raycaster.intersectObjects(this.cachedMeshes, false);
  }

  private findSolidFromIntersection(intersection: THREE.Intersection): SolidObject | null {
    const mesh = intersection.object as THREE.Mesh;

    if (mesh instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
      const solidsMap = this.instancedMeshToSolids.get(mesh.uuid);
      return solidsMap?.get(intersection.instanceId) ?? null;
    }

    return this.meshToSolid.get(mesh) ?? null;
  }

  private findFeatureAtPoint(
    solid: SolidObject,
    intersection: THREE.Intersection,
  ): GeometryFeature | null {
    const faceIdx = intersection.faceIndex;
    if (faceIdx === undefined || faceIdx === null) return null;

    const geometry = solid.mesh.geometry as THREE.BufferGeometry;
    const faceIndexAttr = geometry.getAttribute("faceIndex");

    if (!faceIndexAttr) {
      return solid.features[0] || null;
    }

    const index = geometry.getIndex();
    let vertexIndex: number;
    if (index) {
      vertexIndex = index.getX(faceIdx * 3);
    } else {
      vertexIndex = faceIdx * 3;
    }

    const brepFaceIndex = Math.floor(faceIndexAttr.getX(vertexIndex));

    const featureMap = this.featureIndexMap.get(solid.id);
    if (featureMap) {
      const feature = featureMap.get(brepFaceIndex);
      if (feature) return feature;
    }

    return solid.features[0] || null;
  }

  private handleSelection(
    feature: GeometryFeature,
    solid: SolidObject,
    intersection: THREE.Intersection,
    event: MouseEvent,
  ): void {
    const selectionInfo: SelectionInfo = {
      feature,
      solid,
      point: intersection.point.clone(),
      distance: intersection.distance,
    };

    const isMulti = this.selectionMode === "multi" || event.ctrlKey || event.shiftKey;

    if (isMulti) {
      if (this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature);
        if (feature.solidId) {
          const s = this.solidIdMap.get(feature.solidId);
          if (s && !s.selected) this.highlightSolidEdgeLines(s, false);
        }
        this.onSelectCallback?.({
          selections: this.getSelections(),
          removed: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
        });
      } else {
        this.addSelection(feature);
        if (solid) this.highlightSolidEdgeLines(solid, true);
        this.onSelectCallback?.({
          selections: this.getSelections(),
          added: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
        });
      }
    } else {
      this.clearSelectionInternal();
      this.addSelection(feature);
      if (solid) this.highlightSolidEdgeLines(solid, true);
      this.onSelectCallback?.({
        selections: this.getSelections(),
        added: selectionInfo,
        selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
      });
    }
  }

  private addSelection(feature: GeometryFeature): void {
    if (this.selectedFeatures.has(feature.id)) return;

    this.selectedFeatures.set(feature.id, feature);
    this.applyHighlight(feature, this.selectionColor);

    if (feature.solidId) {
      const solid = this.solidIdMap.get(feature.solidId);
      if (solid) {
        solid.selected = true;
        this.selectedSolids.add(solid.id);
      }
    }
  }

  private removeSelection(feature: GeometryFeature): void {
    if (!this.selectedFeatures.has(feature.id)) return;

    this.selectedFeatures.delete(feature.id);
    this.removeHighlight(feature);
    this.removeFaceHighlight(feature);
    this.removeEdgeHighlight(feature);

    if (feature.solidId) {
      const solid = this.solidIdMap.get(feature.solidId);
      if (solid) {
        const hasOtherSelectedFeature = Array.from(this.selectedFeatures.values()).some(
          (f) => f.solidId === feature.solidId,
        );
        if (!hasOtherSelectedFeature) {
          solid.selected = false;
          this.selectedSolids.delete(solid.id);
        }
      }
    }
  }

  private clearSelectionInternal(): void {
    const meshRestoreMap = new Map<string, { mesh: THREE.Mesh; solid: SolidObject }>();
    this.selectedFeatures.forEach((feature) => {
      if (feature.mesh && !(feature.mesh instanceof THREE.InstancedMesh)) {
        const meshKey = feature.mesh.uuid;
        if (!meshRestoreMap.has(meshKey)) {
          const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined;
          if (solid) meshRestoreMap.set(meshKey, { mesh: feature.mesh, solid });
        }
      }
    });

    const previousSolidIds = Array.from(this.selectedSolids);
    this.selectedFeatures.clear();
    this.selectedSolids.clear();

    meshRestoreMap.forEach(({ mesh, solid }, meshKey) => {
      const originalMaterial = this.originalMaterials.get(meshKey);
      if (originalMaterial) {
        mesh.material = originalMaterial;
        const mat = originalMaterial as THREE.MeshStandardMaterial;
        mat.opacity = solid.opacity;
        mat.transparent = solid.opacity < 1;
        mat.depthWrite = solid.opacity >= 1;
        mat.needsUpdate = true;
      }
      this.originalMaterials.delete(meshKey);

      const staleKeys: string[] = [];
      this.highlightMaterials.forEach((mat, key) => {
        if (key.startsWith(`${meshKey}_`)) {
          mat.dispose();
          staleKeys.push(key);
        }
      });
      staleKeys.forEach((k) => this.highlightMaterials.delete(k));
    });

    if (this.originalInstanceColors.size > 0) {
      const updatedMeshes = new Set<string>();
      this.originalInstanceColors.forEach((origColor, key) => {
        const sepIdx = key.lastIndexOf(":");
        const meshUuid = key.substring(0, sepIdx);
        const instanceId = parseInt(key.substring(sepIdx + 1));
        const instMesh = this.instancedMeshRefs.get(meshUuid);
        if (instMesh) {
          instMesh.setColorAt(instanceId, origColor);
          updatedMeshes.add(meshUuid);
        }
      });
      updatedMeshes.forEach((uuid) => {
        const instMesh = this.instancedMeshRefs.get(uuid);
        if (instMesh?.instanceColor) instMesh.instanceColor.needsUpdate = true;
      });
      this.originalInstanceColors.clear();
    }

    previousSolidIds.forEach((solidId) => {
      const s = this.solidIdMap.get(solidId);
      if (s) {
        s.selected = false;
        this.highlightSolidEdgeLines(s, false);
      }
    });

    this.clearAllFaceHighlights();

    if (this.edgeHighlightOverlays.size > 0) {
      this.clearAllEdgeHighlights();
    }
  }

  clearSelection(): void {
    this.clearSelectionInternal();

    this.onSelectCallback?.({
      selections: [],
      selectedTreeNodeIds: [],
    });
  }

  deselectFeature(featureId: string): void {
    const feature = this.selectedFeatures.get(featureId);
    if (feature) {
      this.removeSelection(feature);
      if (feature.solidId) {
        const solid = this.solidIdMap.get(feature.solidId);
        if (solid && !solid.selected) {
          this.highlightSolidEdgeLines(solid, false);
        }
      }
      this.onSelectCallback?.({
        selections: this.getSelections(),
        selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
      });
    }
  }

  selectBySolidId(solidId: string, multi = false): void {
    const solid = this.solidIdMap.get(solidId);
    if (!solid) return;

    if (!multi) {
      this.clearSelectionInternal();
    }

    const feature = solid.features[0];
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature);
        if (!solid.selected) this.highlightSolidEdgeLines(solid, false);
      } else {
        this.addSelection(feature);
        this.highlightSolidEdgeLines(solid, true);
      }
    }

    const treeIds = multi
      ? this.getSelectedTreeNodeIds()
      : this.selectedFeatures.size > 0
        ? [solidId]
        : [];
    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: treeIds,
    });
  }

  selectSolids(solidIds: string[], multi = false): void {
    if (!multi) this.clearSelectionInternal();

    for (const solidId of solidIds) {
      const solid = this.solidIdMap.get(solidId);
      const feature = solid?.features[0];
      if (!solid || !feature) continue;
      if (this.selectedFeatures.has(feature.id)) continue;
      this.addSelection(feature);
      this.highlightSolidEdgeLines(solid, true);
    }

    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
    });
  }

  hoverBySolidId(solidId: string | null): void {
    if (this.hoveredSolid && !this.hoveredSolid.selected) {
      this.hoverSolidEdgeLines(this.hoveredSolid, false);
    }
    this.hoveredFeature = null;
    this.hoveredMesh = null;
    this.hoveredBrepFaceIndex = -1;

    if (!solidId) {
      this.hoveredSolid = null;
      return;
    }

    const solid = this.solidIdMap.get(solidId);
    if (!solid || solid.selected) {
      this.hoveredSolid = null;
      return;
    }

    this.hoveredSolid = solid;
    this.hoverSolidEdgeLines(solid, true);
  }

  selectByFaceIndex(solidId: string, faceIndex: number, multi = false): void {
    const solid = this.solidIdMap.get(solidId);
    if (!solid) return;

    if (!multi) {
      this.clearSelectionInternal();
    }

    const feature = solid.features.find((f) => f.faceIndex === faceIndex);
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature);
        if (!solid.selected) this.highlightSolidEdgeLines(solid, false);
      } else {
        this.selectedFeatures.set(feature.id, feature);
        this.applyFaceHighlight(feature);
        this.highlightSolidEdgeLines(solid, true);
        solid.selected = true;
        this.selectedSolids.add(solid.id);
      }
    }

    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
    });
  }

  private highlightSolidEdgeLines(solid: SolidObject, selected: boolean): void {
    if (!solid.edgeLines) return;

    if (solid.edgeVertexRange) {
      this.setEdgeVertexColors(
        solid.edgeLines,
        solid.edgeVertexRange,
        selected ? SelectionManager.EDGE_SELECTED_COLOR : SelectionManager.EDGE_DEFAULT_COLOR,
      );
    } else {
      const material = solid.edgeLines.material as THREE.LineBasicMaterial;
      if (selected) {
        material.color.setHex(SelectionManager.EDGE_SELECTED_COLOR);
        material.opacity = SelectionManager.EDGE_HIGHLIGHT_OPACITY;
        material.needsUpdate = true;
      } else {
        material.color.setHex(SelectionManager.EDGE_DEFAULT_COLOR);
        material.opacity = SelectionManager.EDGE_DEFAULT_OPACITY;
        material.needsUpdate = true;
      }
    }
  }

  private setEdgeVertexColors(
    edgeLines: THREE.LineSegments,
    range: [number, number],
    colorHex: number,
  ): void {
    const colors = edgeLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    if (!colors) return;
    const color = new THREE.Color(colorHex);
    const [start, count] = range;
    for (let i = start; i < start + count; i++) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  private getSelectedTreeNodeIds(): string[] {
    const ids: string[] = [];
    this.selectedFeatures.forEach((feature) => {
      if (feature.treeNodeId) ids.push(feature.treeNodeId);
      if (feature.solidId) {
        const solidTreeId = feature.solidId;
        if (!ids.includes(solidTreeId)) ids.push(solidTreeId);
      }
    });
    return ids;
  }

  getSelections(): SelectionInfo[] {
    return Array.from(this.selectedFeatures.values()).map((feature) => {
      const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined;
      return {
        feature,
        solid,
        point: feature.center?.clone() || new THREE.Vector3(),
        distance: 0,
      };
    });
  }

  getSelectedFeatures(): GeometryFeature[] {
    return Array.from(this.selectedFeatures.values());
  }

  private applyHighlight(feature: GeometryFeature, color: number): void {
    const mesh = feature.mesh;
    if (!mesh) return;

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined;

    if (mesh instanceof THREE.InstancedMesh && solid?.instanceId !== undefined) {
      const key = `${mesh.uuid}:${solid.instanceId}`;
      if (!this.originalInstanceColors.has(key)) {
        const origColor = new THREE.Color();
        mesh.getColorAt(solid.instanceId, origColor);
        this.originalInstanceColors.set(key, origColor.clone());
      }
      mesh.setColorAt(solid.instanceId, new THREE.Color(color));
      mesh.instanceColor!.needsUpdate = true;
      return;
    }

    const meshKey = mesh.uuid;
    if (!this.originalMaterials.has(meshKey)) {
      this.originalMaterials.set(meshKey, mesh.material);
    }

    let highlightMaterial = this.highlightMaterials.get(`${meshKey}_${color}`);
    if (!highlightMaterial) {
      const origMat = this.originalMaterials.get(meshKey) as THREE.MeshStandardMaterial;
      highlightMaterial = new THREE.MeshStandardMaterial({
        color: color,
        metalness: origMat?.metalness ?? 0.3,
        roughness: origMat?.roughness ?? 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: origMat?.opacity ?? 1,
        depthWrite: (origMat?.opacity ?? 1) >= 1,
        emissive: new THREE.Color(color).multiplyScalar(0.2),
      });
      this.highlightMaterials.set(`${meshKey}_${color}`, highlightMaterial);
    }

    mesh.material = highlightMaterial;
  }

  private removeHighlight(feature: GeometryFeature): void {
    if (!feature.mesh) return;

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined;

    if (feature.mesh instanceof THREE.InstancedMesh && solid?.instanceId !== undefined) {
      const key = `${feature.mesh.uuid}:${solid.instanceId}`;
      const origColor = this.originalInstanceColors.get(key);
      if (origColor) {
        feature.mesh.setColorAt(solid.instanceId, origColor);
        feature.mesh.instanceColor!.needsUpdate = true;
        this.originalInstanceColors.delete(key);
      }
      return;
    }

    const meshKey = feature.mesh.uuid;

    let otherFeatureOnSameMesh = false;
    this.selectedFeatures.forEach((f) => {
      if (f.id !== feature.id && f.mesh === feature.mesh) {
        otherFeatureOnSameMesh = true;
      }
    });

    if (!otherFeatureOnSameMesh) {
      const originalMaterial = this.originalMaterials.get(meshKey);
      if (originalMaterial) {
        feature.mesh.material = originalMaterial;
        if (solid) {
          const mat = originalMaterial as THREE.MeshStandardMaterial;
          mat.opacity = solid.opacity;
          mat.transparent = solid.opacity < 1;
          mat.depthWrite = solid.opacity >= 1;
          mat.needsUpdate = true;
        }
      }
      this.originalMaterials.delete(meshKey);

      const keysToDelete: string[] = [];
      this.highlightMaterials.forEach((mat, key) => {
        if (key.startsWith(`${meshKey}_`)) {
          mat.dispose();
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach((key) => this.highlightMaterials.delete(key));
    }
  }

  applyFaceHighlight(feature: GeometryFeature): void {
    if (!feature.mesh || feature.faceIndex === undefined) return;
    if (this.faceHighlightOverlays.has(feature.id)) return;

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined;
    if (!solid) return;

    const geometry = solid.mesh.geometry as THREE.BufferGeometry;
    const faceIndexAttr = geometry.getAttribute("faceIndex");
    if (!faceIndexAttr) return;

    const posAttr = geometry.getAttribute("position");
    const normalAttr = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    const targetFaceIndex = feature.faceIndex;

    const sourceIndices: number[] = [];
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        if (Math.floor(faceIndexAttr.getX(index.getX(i))) !== targetFaceIndex) continue;
        sourceIndices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        if (Math.floor(faceIndexAttr.getX(i)) !== targetFaceIndex) continue;
        sourceIndices.push(i, i + 1, i + 2);
      }
    }

    if (sourceIndices.length === 0) return;

    const positions = new Float32Array(sourceIndices.length * 3);
    const normals = normalAttr ? new Float32Array(sourceIndices.length * 3) : null;
    for (let i = 0; i < sourceIndices.length; i++) {
      const v = sourceIndices[i];
      const o = i * 3;
      positions[o] = posAttr.getX(v);
      positions[o + 1] = posAttr.getY(v);
      positions[o + 2] = posAttr.getZ(v);
      if (normals) {
        normals[o] = normalAttr.getX(v);
        normals[o + 1] = normalAttr.getY(v);
        normals[o + 2] = normalAttr.getZ(v);
      }
    }

    const overlayGeo = new THREE.BufferGeometry();
    overlayGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (normals) {
      overlayGeo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }

    const overlayMesh = new THREE.Mesh(overlayGeo, this.faceHighlightMaterial);
    overlayMesh.name = `faceHighlight_${feature.id}`;
    overlayMesh.renderOrder = 2;

    if (solid.mesh instanceof THREE.InstancedMesh && solid.instanceId !== undefined) {
      const matrix = new THREE.Matrix4();
      solid.mesh.getMatrixAt(solid.instanceId, matrix);
      overlayMesh.applyMatrix4(matrix);
    }

    this.scene.add(overlayMesh);
    this.faceHighlightOverlays.set(feature.id, overlayMesh);
  }

  removeFaceHighlight(feature: GeometryFeature): void {
    const overlay = this.faceHighlightOverlays.get(feature.id);
    if (overlay) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      this.faceHighlightOverlays.delete(feature.id);
    }
  }

  clearAllFaceHighlights(): void {
    this.faceHighlightOverlays.forEach((overlay) => {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
    });
    this.faceHighlightOverlays.clear();
  }

  setOpacity(solidId: string | null, opacity: number): void {
    const targets = solidId ? this.solids.filter((s) => s.id === solidId) : this.solids;

    const isTransparent = opacity < 1;

    targets.forEach((solid) => {
      solid.opacity = opacity;
      const material = solid.mesh.material as THREE.MeshStandardMaterial;
      if (material) {
        material.opacity = opacity;
        material.transparent = isTransparent;
        material.depthWrite = !isTransparent;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }

      const meshKey = solid.mesh.uuid;
      this.highlightMaterials.forEach((mat, key) => {
        if (key.startsWith(`${meshKey}_`)) {
          mat.opacity = opacity;
          mat.transparent = isTransparent;
          mat.depthWrite = !isTransparent;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      });

      const origMat = this.originalMaterials.get(meshKey) as THREE.MeshStandardMaterial;
      if (origMat && origMat !== solid.mesh.material) {
        origMat.opacity = opacity;
        origMat.transparent = isTransparent;
        origMat.depthWrite = !isTransparent;
        origMat.side = THREE.DoubleSide;
        origMat.needsUpdate = true;
      }
    });
  }

  toggleTransparency(solidId?: string): void {
    if (solidId) {
      const solid = this.solidIdMap.get(solidId);
      if (solid) {
        const newOpacity = solid.opacity > 0.5 ? 0.3 : 1;
        this.setOpacity(solidId, newOpacity);
      }
    } else {
      const anyOpaque = this.solids.some((s) => s.opacity > 0.5);
      const newOpacity = anyOpaque ? 0.3 : 1;
      this.setOpacity(null, newOpacity);
    }
  }

  setTransparent(transparent: boolean): void {
    this.setOpacity(null, transparent ? 0.3 : 1);
  }

  setGranularityMode(mode: GranularityMode): void {
    if (this.granularityMode === mode) return;
    this.granularityMode = mode;

    this.clearSelectionInternal();
    this.clearHoverHighlight();
    this.removeHoverEdgeOverlay();
    this.hoveredFeature = null;
    this.hoveredMesh = null;
    this.hoveredSolid = null;
    this.hoveredBrepFaceIndex = -1;
    this.axisCandidates = [];
    this.axisCandidateIndex = 0;
    this.lastAxisPickEvent = null;

    this.solids.forEach((s) => {
      if (s.topologyEdges) {
        s.topologyEdges.visible = mode === "edge";
      }
    });

    this.onSelectCallback?.({
      selections: [],
      selectedTreeNodeIds: [],
    });

    this.onRenderRequest?.();
  }

  getGranularityMode(): GranularityMode {
    return this.granularityMode;
  }

  private performEdgeHoverCheck(event: MouseEvent): void {
    this.lastAxisPickEvent = { clientX: event.clientX, clientY: event.clientY };
    this.axisCandidates = this.collectAxisPickCandidates(event);
    this.axisCandidateIndex = 0;
    this.applyAxisCandidateHover();
  }

  cycleAxisCandidate(step = 1): void {
    if (this.granularityMode !== "edge") return;
    if (this.axisCandidates.length <= 1) return;
    const total = this.axisCandidates.length;
    this.axisCandidateIndex = (this.axisCandidateIndex + step + total) % total;
    this.applyAxisCandidateHover(true);
  }

  onAxisCandidates(callback: (info: AxisCandidateInfo) => void): void {
    this.onAxisCandidatesCallback = callback;
  }

  getCurrentAxisCandidate(): AxisPickCandidate | null {
    return this.axisCandidates[this.axisCandidateIndex] ?? null;
  }

  private applyAxisCandidateHover(force = false): void {
    const candidate = this.axisCandidates[this.axisCandidateIndex];

    if (!candidate) {
      if (this.hoveredFeature) {
        this.clearHoverHighlight();
        this.hoveredFeature = null;
        this.hoveredMesh = null;
        this.hoveredSolid = null;
        this.hoveredBrepFaceIndex = -1;
        this.onHoverCallback?.(null);
        this.onRenderRequest?.();
      }
      this.onAxisCandidatesCallback?.({ index: 0, total: 0, description: "" });
      return;
    }

    if (!force && candidate.feature === this.hoveredFeature) {
      this.onAxisCandidatesCallback?.({
        index: this.axisCandidateIndex,
        total: this.axisCandidates.length,
        description: candidate.description,
      });
      return;
    }

    this.clearHoverHighlight();

    if (candidate.kind === "edge" && !this.selectedFeatures.has(candidate.feature.id)) {
      this.setTopologyEdgeColor(
        candidate.solid,
        candidate.edgeIndex,
        SelectionManager.EDGE_HOVER_COLOR,
      );
      this.createHoverEdgeOverlay(candidate.solid, candidate.edgeIndex);
    }

    this.hoveredFeature = candidate.feature;
    this.hoveredSolid = candidate.solid;
    this.hoveredBrepFaceIndex = candidate.kind === "edge" ? candidate.edgeIndex : -1;
    this.onHoverCallback?.(candidate.feature);
    this.onAxisCandidatesCallback?.({
      index: this.axisCandidateIndex,
      total: this.axisCandidates.length,
      description: candidate.description,
    });
    this.onRenderRequest?.();
  }

  private collectAxisPickCandidates(event: MouseEvent): AxisPickCandidate[] {
    const rect = this.cachedRect || this.domElement.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const ndc = new THREE.Vector2(mx, my);

    const camDist =
      this.camera instanceof THREE.PerspectiveCamera ? this.camera.position.length() : 100;
    const lineThreshold = Math.max(0.5, Math.min(5, camDist * 0.005));

    const results: AxisPickCandidate[] = [];
    const seen = new Set<string>();

    this.edgeRaycaster.params.Line!.threshold = lineThreshold;
    this.edgeRaycaster.setFromCamera(ndc, this.camera);
    const edgeHits = this.edgeRaycaster.intersectObjects(this.cachedTopologyEdges, false);

    for (const hit of edgeHits) {
      const resolved = this.resolveEdgeHit(hit);
      if (!resolved) continue;
      if (seen.has(resolved.feature.id)) continue;
      const curve = resolved.feature.edgeCurveType;
      if (curve !== "circle" && curve !== "arc" && curve !== "line") continue;
      seen.add(resolved.feature.id);
      results.push({
        solid: resolved.solid,
        feature: resolved.feature,
        edgeIndex: resolved.edgeIndex,
        kind: "edge",
        distance: hit.distance,
        description: this.describeCandidate(resolved.feature, "edge"),
      });
    }

    this.axisRaycaster.setFromCamera(ndc, this.camera);
    const faceHits = this.axisRaycaster.intersectObjects(this.cachedMeshes, false);

    for (const hit of faceHits) {
      const solid = this.findSolidFromIntersection(hit);
      if (!solid) continue;
      const feature = this.findFeatureAtPoint(solid, hit);
      if (!feature) continue;
      if (!AXIS_PICK_FACE_TYPES.has(feature.type)) continue;
      if (!feature.center) continue;
      const axis = feature.axis || feature.normal;
      if (!axis) continue;

      const projected = projectPointOnAxis(hit.point, feature.center, axis);
      const key = `${feature.id}_face`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        solid,
        feature: { ...feature, center: projected },
        edgeIndex: -1,
        kind: "face",
        distance: hit.distance,
        description: this.describeCandidate(feature, "face"),
      });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  private describeCandidate(feature: GeometryFeature, kind: "edge" | "face"): string {
    const d = feature.radius !== undefined ? `Ø${(feature.radius * 2).toFixed(2)}` : "";
    if (kind === "face") {
      const t = feature.type === FeatureType.CONE ? "圆锥面" : "圆柱面";
      return `${t} ${d}`.trim();
    }
    const curve = feature.edgeCurveType;
    const t = curve === "circle" ? "整圆边" : curve === "arc" ? "圆弧边" : "直线边";
    return `${t} ${d}`.trim();
  }

  private resolveEdgeHit(hit: THREE.Intersection): {
    solid: SolidObject;
    feature: GeometryFeature;
    edgeIndex: number;
  } | null {
    const lineSegs = hit.object as THREE.LineSegments;
    const geo = lineSegs.geometry as THREE.BufferGeometry;
    const edgeIndexAttr = geo.getAttribute("edgeIndex");
    if (!edgeIndexAttr || hit.index === undefined) return null;

    const edgeIndex = Math.floor(edgeIndexAttr.getX(hit.index));

    for (const solid of this.solids) {
      if (solid.topologyEdges !== lineSegs) continue;

      if (solid.topologyEdgeVertexRanges) {
        const range = solid.topologyEdgeVertexRanges.get(edgeIndex);
        if (range) {
          const [start, count] = range;
          if (hit.index >= start && hit.index < start + count) {
            const feature = this.edgeIndexMap.get(solid.id)?.get(edgeIndex);
            if (feature) return { solid, feature, edgeIndex };
          }
        }
        continue;
      }

      const feature = this.edgeIndexMap.get(solid.id)?.get(edgeIndex);
      if (feature) return { solid, feature, edgeIndex };
    }

    return null;
  }

  private handleEdgeClick(event: MouseEvent): void {
    const moved =
      !this.lastAxisPickEvent ||
      Math.abs(this.lastAxisPickEvent.clientX - event.clientX) > 2 ||
      Math.abs(this.lastAxisPickEvent.clientY - event.clientY) > 2;

    if (moved) {
      this.lastAxisPickEvent = { clientX: event.clientX, clientY: event.clientY };
      this.axisCandidates = this.collectAxisPickCandidates(event);
      this.axisCandidateIndex = 0;
    }

    const candidate = this.axisCandidates[this.axisCandidateIndex];
    if (!candidate) return;

    const { solid, feature } = candidate;

    const selectionInfo: SelectionInfo = {
      feature,
      solid,
      point: feature.startPoint?.clone() || new THREE.Vector3(),
      distance: 0,
    };

    const isMulti = this.selectionMode === "multi" || event.ctrlKey || event.shiftKey;

    if (isMulti) {
      if (this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature);
        this.removeEdgeHighlight(feature);
        this.onSelectCallback?.({
          selections: this.getSelections(),
          removed: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
        });
      } else {
        this.selectedFeatures.set(feature.id, feature);
        this.applyEdgeHighlight(feature);
        if (feature.solidId) {
          const s = this.solidIdMap.get(feature.solidId);
          if (s) {
            s.selected = true;
            this.selectedSolids.add(s.id);
          }
        }
        this.onSelectCallback?.({
          selections: this.getSelections(),
          added: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
        });
      }
    } else {
      this.clearSelectionInternal();
      this.selectedFeatures.set(feature.id, feature);
      this.applyEdgeHighlight(feature);
      if (feature.solidId) {
        const s = this.solidIdMap.get(feature.solidId);
        if (s) {
          s.selected = true;
          this.selectedSolids.add(s.id);
        }
      }
      this.onSelectCallback?.({
        selections: this.getSelections(),
        added: selectionInfo,
        selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
      });
    }
  }

  applyEdgeHighlight(feature: GeometryFeature): void {
    if (!feature.solidId || feature.edgeIndex === undefined) return;
    if (this.edgeHighlightOverlays.has(feature.id)) return;

    const solid = this.solidIdMap.get(feature.solidId);
    if (!solid || !solid.topologyEdges) return;

    this.setTopologyEdgeColor(solid, feature.edgeIndex, SelectionManager.EDGE_SELECTED_COLOR);

    const overlayGeo = this.buildEdgeOverlayGeometry(solid, feature.edgeIndex);
    if (!overlayGeo) return;

    const overlay = new THREE.LineSegments(overlayGeo, this.selectedEdgeMaterial);
    overlay.renderOrder = 999;
    overlay.matrixAutoUpdate = false;
    overlay.matrix.copy(solid.topologyEdges.matrixWorld);

    this.scene.add(overlay);
    this.edgeHighlightOverlays.set(feature.id, overlay);
  }

  removeEdgeHighlight(feature: GeometryFeature): void {
    if (!feature.solidId || feature.edgeIndex === undefined) return;

    const solid = this.solidIdMap.get(feature.solidId);
    if (solid?.topologyEdges) {
      this.setTopologyEdgeColor(solid, feature.edgeIndex, 0x444444);
    }

    const overlay = this.edgeHighlightOverlays.get(feature.id);
    if (overlay) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      this.edgeHighlightOverlays.delete(feature.id);
    }
  }

  clearAllEdgeHighlights(): void {
    const defaultColor = new THREE.Color(0x444444);
    for (const solid of this.solids) {
      const colAttr = solid.topologyEdges?.geometry.getAttribute("color") as
        | THREE.BufferAttribute
        | undefined;
      if (!colAttr) continue;
      for (let i = 0; i < colAttr.count; i++) {
        colAttr.setXYZ(i, defaultColor.r, defaultColor.g, defaultColor.b);
      }
      colAttr.needsUpdate = true;
    }
    this.edgeHighlightOverlays.forEach((overlay) => {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
    });
    this.edgeHighlightOverlays.clear();
  }

  private setTopologyEdgeColor(solid: SolidObject, edgeIndex: number, colorHex: number): void {
    if (!solid.topologyEdges) return;

    const geo = solid.topologyEdges.geometry;
    const edgeIndexAttr = geo.getAttribute("edgeIndex") as THREE.BufferAttribute;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;

    if (colAttr && edgeIndexAttr) {
      const color = new THREE.Color(colorHex);
      for (let i = 0; i < edgeIndexAttr.count; i++) {
        if (Math.floor(edgeIndexAttr.getX(i)) === edgeIndex) {
          colAttr.setXYZ(i, color.r, color.g, color.b);
        }
      }
      colAttr.needsUpdate = true;
    } else if (edgeIndexAttr) {
      const positions = geo.getAttribute("position");
      const colors = new Float32Array(positions.count * 3);
      const defaultColor = new THREE.Color(0x444444);
      const targetColor = new THREE.Color(colorHex);

      for (let i = 0; i < positions.count; i++) {
        const ei = Math.floor(edgeIndexAttr.getX(i));
        const c = ei === edgeIndex ? targetColor : defaultColor;
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }

      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const mat = solid.topologyEdges.material as THREE.LineBasicMaterial;
      mat.vertexColors = true;
      mat.needsUpdate = true;
    }
  }

  selectByEdgeIndex(solidId: string, edgeIndex: number, multi = false): void {
    const solid = this.solidIdMap.get(solidId);
    if (!solid) return;

    if (!multi) {
      this.clearSelectionInternal();
    }

    const feature = solid.edgeFeatures.find((f) => f.edgeIndex === edgeIndex);
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature);
        this.removeEdgeHighlight(feature);
      } else {
        this.selectedFeatures.set(feature.id, feature);
        this.applyEdgeHighlight(feature);
        solid.selected = true;
        this.selectedSolids.add(solid.id);
      }
    }

    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: this.getSelectedTreeNodeIds(),
    });
  }

  setVisibility(solidId: string, visible: boolean): void {
    const solid = this.solidIdMap.get(solidId);
    if (solid) {
      solid.visible = visible;
      solid.mesh.visible = visible;
      if (solid.topologyEdges) {
        solid.topologyEdges.visible = visible;
      }
      this.updateCachedMeshes();
      this.updateCachedTopologyEdges();
    }
  }

  updateCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  dispose(): void {
    this.rafThrottledMouseMove.cancel();

    this.clearHoverHighlight();
    this.hoveredFeature = null;
    this.hoveredMesh = null;
    this.hoveredSolid = null;

    if (this.orbitControls) {
      this.orbitControls.removeEventListener("start", this.handleOrbitStart);
      this.orbitControls.removeEventListener("end", this.handleOrbitEnd);
      this.orbitControls = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.domElement.removeEventListener("click", this.handleClick);
    this.domElement.removeEventListener("dblclick", this.handleDoubleClick);
    this.domElement.removeEventListener("mousemove", this.handleMouseMove);
    this.domElement.removeEventListener("mousedown", this.handleMouseDown);
    this.domElement.removeEventListener("mouseup", this.handleMouseUp);
    this.domElement.removeEventListener("mouseleave", this.handleMouseLeave);
    this.domElement.removeEventListener("contextmenu", this.handleContextMenu);

    this.highlightMaterials.forEach((mat) => mat.dispose());
    this.highlightMaterials.clear();
    this.originalMaterials.clear();
    this.originalInstanceColors.clear();
    this.instancedMeshRefs.clear();
    this.instancedMeshToSolids.clear();
    this.selectedFeatures.clear();
    this.selectedSolids.clear();
    this.clearAllFaceHighlights();
    this.clearAllEdgeHighlights();
    this.removeHoverEdgeOverlay();
    this.faceHighlightMaterial.dispose();
    this.edgeHighlightMaterial.dispose();
    this.hoverEdgeMaterial.dispose();
    this.selectedEdgeMaterial.dispose();
    this.featureIndexMap.clear();
    this.edgeIndexMap.clear();
    this.meshToSolid.clear();
    this.solidIdMap.clear();
    this.solids = [];
    this.cachedMeshes = [];
    this.cachedTopologyEdges = [];
    this.cachedRect = null;
  }
}

export default SelectionManager;
