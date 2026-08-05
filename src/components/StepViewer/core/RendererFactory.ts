import * as THREE from "three";

export type RendererType = "webgpu" | "webgl";

export type UniversalRenderer = THREE.WebGLRenderer | any;

export interface RendererConfig {
  antialias?: boolean;
  alpha?: boolean;
  preserveDrawingBuffer?: boolean;
  canvas?: HTMLCanvasElement;
}

export interface RendererResult {
  renderer: UniversalRenderer;
  type: RendererType;
}

export async function isWebGPUAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function createWebGPURenderer(config: RendererConfig): Promise<UniversalRenderer | null> {
  try {
    const { WebGPURenderer } = await import("three/webgpu");

    const renderer = new WebGPURenderer({
      antialias: config.antialias !== false,
      alpha: config.alpha,
      canvas: config.canvas,
    });

    await renderer.init();
    return renderer;
  } catch (error) {
    console.warn("WebGPU 渲染器创建失败，将降级到 WebGL:", error);
    return null;
  }
}

function createWebGLRenderer(config: RendererConfig): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({
    antialias: config.antialias !== false,
    alpha: config.alpha ?? true,
    preserveDrawingBuffer: config.preserveDrawingBuffer ?? true,
    canvas: config.canvas,
  });
}

export async function createRenderer(
  config: RendererConfig = {},
  preferWebGPU = true,
): Promise<RendererResult> {
  if (preferWebGPU && (await isWebGPUAvailable())) {
    const webgpuRenderer = await createWebGPURenderer(config);
    if (webgpuRenderer) return { renderer: webgpuRenderer, type: "webgpu" };
  }

  return { renderer: createWebGLRenderer(config), type: "webgl" };
}

export function configureRenderer(
  renderer: UniversalRenderer,
  type: RendererType,
  options: {
    width: number;
    height: number;
    pixelRatio?: number;
    shadowMapEnabled?: boolean;
    toneMapping?: THREE.ToneMapping;
    toneMappingExposure?: number;
    outputColorSpace?: THREE.ColorSpace;
  },
): void {
  renderer.setSize(options.width, options.height);
  renderer.setPixelRatio(Math.min(options.pixelRatio ?? window.devicePixelRatio, 2));
  renderer.outputColorSpace = options.outputColorSpace ?? THREE.SRGBColorSpace;
  renderer.toneMapping = options.toneMapping ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = options.toneMappingExposure ?? 1.0;

  if (type === "webgl") {
    const glRenderer = renderer as THREE.WebGLRenderer;
    glRenderer.shadowMap.enabled = options.shadowMapEnabled ?? true;
    glRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } else {
    if (options.shadowMapEnabled !== false && renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.VSMShadowMap;
    }
  }
}

export function takeScreenshot(
  renderer: UniversalRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}
