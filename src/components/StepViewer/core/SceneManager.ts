import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import type { ViewPreset, CameraConfig } from "../types";
import {
  createRenderer,
  configureRenderer,
  takeScreenshot,
  type RendererType,
  type UniversalRenderer,
} from "./RendererFactory";

const WORLD_UP = new THREE.Vector3(0, 0, 1);

export interface SceneManagerConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
  backgroundColor?: number;
  antialias?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  preferWebGPU?: boolean;
}

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer!: UniversalRenderer;
  public controls: OrbitControls;
  public viewHelper: ViewHelper | null = null;
  public rendererType: RendererType = "webgl";

  public frameDrawCalls = 0;
  public sceneTriangles = 0;
  public sceneVertices = 0;

  private container: HTMLElement;
  private animationId: number | null = null;
  private width: number;
  private height: number;

  private axesHelper: THREE.AxesHelper | null = null;
  private gridHelper: THREE.GridHelper | null = null;
  private axesSize = 100;
  private gridSize = 500;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  public modelGroup: THREE.Group;

  private renderCallbacks: Array<() => void> = [];

  private _needsRender = true;
  private disposed = false;
  private isAnimating = false;
  private _viewHelperWasAnimating = false;
  private timer = new THREE.Timer();
  private readonly VIEW_HELPER_DIM = 128;

  private initPromise: Promise<void>;

  constructor(config: SceneManagerConfig) {
    this.container = config.container;
    this.width = config.width || config.container.clientWidth;
    this.height = config.height || config.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(config.backgroundColor ?? 0xf5f5f5);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 10000);
    this.camera.up.copy(WORLD_UP);
    this.camera.position.set(100, -100, 100);

    this.initPromise = this.initRenderer(config);

    const tempCanvas = document.createElement("canvas");
    this.container.appendChild(tempCanvas);

    this.controls = new OrbitControls(this.camera, tempCanvas);
    this.configureControls();

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(100, -50, 100);
    this.scene.add(this.directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-100, 100, -50);
    this.scene.add(fillLight);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    if (config.showAxes) {
      this.showAxes(true);
    }
    if (config.showGrid) {
      this.showGrid(true);
    }

    window.addEventListener("resize", this.handleResize);

    this.startRenderLoop();
  }

  private async initRenderer(config: SceneManagerConfig): Promise<void> {
    const { renderer, type } = await createRenderer(
      {
        antialias: config.antialias !== false,
        alpha: true,
        preserveDrawingBuffer: true,
      },
      config.preferWebGPU !== false,
    );

    this.renderer = renderer;
    this.rendererType = type;

    configureRenderer(renderer, type, {
      width: this.width,
      height: this.height,
      shadowMapEnabled: true,
    });

    const tempCanvas = this.container.querySelector("canvas");
    if (tempCanvas) {
      this.container.removeChild(tempCanvas);
    }
    this.container.appendChild(renderer.domElement);

    this.controls.dispose();
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.configureControls();

    this.syncControlsToCamera();

    this.viewHelper = new ViewHelper(this.camera, renderer.domElement);
    this.viewHelper.center = this.controls.target;
    try {
      this.viewHelper.setLabels("X", "Y", "Z");
    } catch {}

    this.markDirty();
  }

  async waitForReady(): Promise<void> {
    await this.initPromise;
  }

  private handleResize = () => {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    if (this.renderer) {
      this.renderer.setSize(this.width, this.height);
    }
    this.markDirty();
  };

  markDirty(): void {
    this._needsRender = true;
  }

  requestRender(): void {
    this._needsRender = true;
  }

  private computeSceneStats(): void {
    let totalVertices = 0;
    let totalTriangles = 0;
    this.modelGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const geo = obj.geometry as THREE.BufferGeometry;
        const posAttr = geo.getAttribute("position");
        if (posAttr) totalVertices += posAttr.count;
        const idx = geo.getIndex();
        if (idx) {
          totalTriangles += idx.count / 3;
        } else if (posAttr) {
          totalTriangles += posAttr.count / 3;
        }
      }
    });
    this.sceneTriangles = Math.round(totalTriangles);
    this.sceneVertices = totalVertices;
  }

  private configureControls(): void {
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 5000;
    this.controls.rotateSpeed = 0.9;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 1;

    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    this.controls.addEventListener("change", () => {
      this.markDirty();
    });
  }

  private nudgeOffPole(): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const radius = offset.length();
    if (radius <= 0) return;

    const horizontal = Math.hypot(offset.x, offset.y);
    const minHorizontal = radius * 1e-3;
    if (horizontal >= minHorizontal) return;

    if (horizontal > 0) {
      const k = minHorizontal / horizontal;
      offset.x *= k;
      offset.y *= k;
    } else {
      offset.y = -minHorizontal;
    }
    offset.setLength(radius);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  private syncControlsToCamera(): void {
    this.camera.up.copy(WORLD_UP);
    this.nudgeOffPole();
    this.camera.updateMatrixWorld(true);
    this.controls.update();
  }

  private startRenderLoop() {
    const animate = () => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(animate);

      this.timer.update();
      const delta = this.timer.getDelta();

      let viewHelperAnimating = false;
      if (this.viewHelper) {
        viewHelperAnimating = this.viewHelper.animating;
        if (viewHelperAnimating) {
          this.viewHelper.update(delta);
          this.markDirty();
        }
      }

      if (viewHelperAnimating) {
        this.camera.up.copy(WORLD_UP);
      } else {
        if (this._viewHelperWasAnimating) {
          this.syncControlsToCamera();
        }
        this.controls.update();
      }
      this._viewHelperWasAnimating = viewHelperAnimating;

      const shouldRender = this._needsRender || this.isAnimating || viewHelperAnimating;

      if (shouldRender && this.renderer && this.width > 0 && this.height > 0) {
        this.renderer.setViewport(0, 0, this.width, this.height);

        this.renderer.render(this.scene, this.camera);

        if (this.viewHelper) {
          const savedAutoClear = this.renderer.autoClear;
          this.renderer.autoClear = false;
          try {
            this.viewHelper.render(this.renderer as any);
          } catch {
          } finally {
            this.renderer.autoClear = savedAutoClear;
          }
        }

        this.frameDrawCalls = this.renderer.info?.render?.calls ?? 0;

        this.renderCallbacks.forEach((callback) => callback());

        this._needsRender = false;
      }
    };
    animate();
  }

  addRenderCallback(callback: () => void): void {
    this.renderCallbacks.push(callback);
  }

  removeRenderCallback(callback: () => void): void {
    const index = this.renderCallbacks.indexOf(callback);
    if (index > -1) {
      this.renderCallbacks.splice(index, 1);
    }
  }

  showAxes(show: boolean, size: number = this.axesSize): void {
    this.axesSize = size;
    if (show) {
      if (!this.axesHelper) {
        this.axesHelper = new THREE.AxesHelper(size);
        this.scene.add(this.axesHelper);
      }
    } else {
      if (this.axesHelper) {
        this.scene.remove(this.axesHelper);
        this.axesHelper.dispose();
        this.axesHelper = null;
      }
    }
    this.markDirty();
  }

  showGrid(show: boolean, size: number = this.gridSize, divisions: number = 50): void {
    this.gridSize = size;
    if (show) {
      if (!this.gridHelper) {
        this.gridHelper = new THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
        this.gridHelper.rotation.x = Math.PI / 2;
        this.gridHelper.position.z = -0.01;
        this.scene.add(this.gridHelper);
      }
    } else {
      if (this.gridHelper) {
        this.scene.remove(this.gridHelper);
        this.gridHelper.dispose();
        this.gridHelper = null;
      }
    }
    this.markDirty();
  }

  addModel(object: THREE.Object3D): void {
    this.modelGroup.add(object);
    this.computeSceneStats();
    this.markDirty();
  }

  removeModel(object: THREE.Object3D): void {
    this.modelGroup.remove(object);
    this.markDirty();
  }

  clearModels(): void {
    const materials = new Set<THREE.Material>();

    while (this.modelGroup.children.length > 0) {
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      this.disposeObject(child, materials);
    }

    materials.forEach((m) => this.disposeMaterial(m));

    this.computeSceneStats();
    this.markDirty();
  }

  private disposeMaterial(material: THREE.Material): void {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }

  private disposeObject(object: THREE.Object3D, out: Set<THREE.Material>): void {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      const geo = object.geometry as THREE.BufferGeometry & {
        boundsTree?: unknown;
        disposeBoundsTree?: () => void;
      };
      if (geo) {
        if (geo.boundsTree && typeof geo.disposeBoundsTree === "function") {
          geo.disposeBoundsTree();
        }
        geo.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((m) => out.add(m));
        } else {
          out.add(object.material);
        }
      }
    }
    if (object instanceof THREE.InstancedMesh) {
      object.dispose();
    }
    object.children.forEach((child) => this.disposeObject(child, out));
  }

  fitToModel(padding: number = 1.5): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup);

    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = this.camera.fov * (Math.PI / 180);
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
    cameraDistance *= padding;
    if (!(cameraDistance > 0) || !isFinite(cameraDistance)) cameraDistance = 100;

    this.controls.minDistance = Math.max(cameraDistance / 500, 1e-4);
    this.controls.maxDistance = Math.max(cameraDistance * 200, 5000);
    this.syncHelperScale(maxDim);

    const direction = new THREE.Vector3(1, -1, 1).normalize();
    this.camera.position.copy(center).add(direction.multiplyScalar(cameraDistance));
    this.camera.up.copy(WORLD_UP);

    this.controls.target.copy(center);
    this.syncControlsToCamera();

    this.camera.near = cameraDistance / 100;
    this.camera.far = cameraDistance * 100;
    this.camera.updateProjectionMatrix();

    this.directionalLight.position.copy(this.camera.position);

    if (this.viewHelper) {
      this.viewHelper.center.copy(center);
    }

    this.markDirty();
  }

  private syncHelperScale(maxDim: number): void {
    if (!(maxDim > 0) || !isFinite(maxDim)) return;

    const magnitude = Math.pow(10, Math.round(Math.log10(maxDim * 4)));
    if (this.gridSize > 0 && magnitude / this.gridSize < 4 && this.gridSize / magnitude < 4) return;

    this.gridSize = magnitude;
    this.axesSize = magnitude / 5;

    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.dispose();
      this.gridHelper = null;
      this.showGrid(true);
    }
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
      this.axesHelper.dispose();
      this.axesHelper = null;
      this.showAxes(true);
    }
  }

  handleViewHelperClick(event: PointerEvent | MouseEvent): boolean {
    if (!this.viewHelper || !this.renderer) return false;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dim = this.VIEW_HELPER_DIM;

    if (x < rect.width - dim || y < rect.height - dim) {
      return false;
    }

    const hit = this.viewHelper.handleClick(event as PointerEvent);
    if (hit) {
      this.markDirty();
    }
    return hit;
  }

  setViewPreset(preset: ViewPreset, animate: boolean = true): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) * 2;

    let position: THREE.Vector3;
    const up = WORLD_UP.clone();

    switch (preset) {
      case "front":
        position = new THREE.Vector3(0, -maxDim, 0);
        break;
      case "back":
        position = new THREE.Vector3(0, maxDim, 0);
        break;
      case "top":
        position = new THREE.Vector3(0, -maxDim * 1e-4, maxDim);
        break;
      case "bottom":
        position = new THREE.Vector3(0, -maxDim * 1e-4, -maxDim);
        break;
      case "left":
        position = new THREE.Vector3(-maxDim, 0, 0);
        break;
      case "right":
        position = new THREE.Vector3(maxDim, 0, 0);
        break;
      case "isometric":
      default:
        position = new THREE.Vector3(maxDim, -maxDim, maxDim * 0.8);
        break;
    }

    position.add(center);

    if (animate) {
      this.animateCameraTo(position, center, up);
    } else {
      this.camera.position.copy(position);
      this.camera.up.copy(up);
      this.controls.target.copy(center);
      this.syncControlsToCamera();
    }
  }

  private animateCameraTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    up: THREE.Vector3,
    duration: number = 500,
  ): void {
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startUp = this.camera.up.clone();
    const startTime = Date.now();

    this.isAnimating = true;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const easeT = 1 - Math.pow(1 - t, 3);

      this.camera.position.lerpVectors(startPosition, position, easeT);
      this.controls.target.lerpVectors(startTarget, target, easeT);
      this.camera.up.lerpVectors(startUp, up, easeT);
      this.syncControlsToCamera();

      if (this.viewHelper) {
        this.viewHelper.center.copy(this.controls.target);
      }

      this.markDirty();

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isAnimating = false;
      }
    };
    animate();
  }

  getCameraConfig(): CameraConfig {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  setCameraConfig(config: Partial<CameraConfig>, animate: boolean = false): void {
    if (animate && config.position && config.target) {
      this.animateCameraTo(config.position, config.target, config.up || WORLD_UP.clone());
    } else {
      if (config.position) this.camera.position.copy(config.position);
      if (config.target) this.controls.target.copy(config.target);
      if (config.up) this.camera.up.copy(config.up);
      if (config.fov) this.camera.fov = config.fov;
      if (config.near) this.camera.near = config.near;
      if (config.far) this.camera.far = config.far;
      this.camera.updateProjectionMatrix();
      this.syncControlsToCamera();
      this.markDirty();
    }
  }

  setBackgroundColor(color: number): void {
    this.scene.background = new THREE.Color(color);
    this.markDirty();
  }

  screenshot(): string {
    return takeScreenshot(this.renderer, this.scene, this.camera);
  }

  renderFrame(): void {
    if (!this.renderer || this.width <= 0 || this.height <= 0) return;
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.render(this.scene, this.camera);
  }

  getDomElement(): HTMLCanvasElement {
    if (!this.renderer) {
      throw new Error("Renderer 尚未初始化，请先调用 await waitForReady()");
    }
    return this.renderer.domElement;
  }

  updateSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;

    this.width = width;
    this.height = height;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (this.renderer) {
      this.renderer.setSize(width, height);
    }
    this.markDirty();
  }

  dispose(): void {
    this.disposed = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener("resize", this.handleResize);

    this.renderCallbacks.length = 0;

    this.controls.dispose();

    if (this.viewHelper) {
      this.viewHelper.dispose();
      this.viewHelper = null;
    }

    this.clearModels();

    this.showAxes(false);
    this.showGrid(false);

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
      if (this.renderer.domElement?.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}

export default SceneManager;
