/**
 * 渲染器工厂
 * 运行时检测 WebGPU 支持，自动选择最佳渲染器并降级到 WebGL
 *
 * 策略：
 * 1. 检测 navigator.gpu 是否可用
 * 2. 可用则创建 WebGPURenderer（异步初始化）
 * 3. 不可用或初始化失败则 fallback 到 WebGLRenderer
 */

import * as THREE from 'three'

/** 渲染器类型标识 */
export type RendererType = 'webgpu' | 'webgl'

/** 通用渲染器类型 */
export type UniversalRenderer = THREE.WebGLRenderer | any // WebGPURenderer 类型在运行时动态导入

/** 渲染器创建配置 */
export interface RendererConfig {
  antialias?: boolean
  alpha?: boolean
  preserveDrawingBuffer?: boolean
  canvas?: HTMLCanvasElement
}

/** 渲染器创建结果 */
export interface RendererResult {
  renderer: UniversalRenderer
  type: RendererType
}

/**
 * 检测 WebGPU 是否可用
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  if (!('gpu' in navigator)) return false

  try {
    const gpu = (navigator as any).gpu
    if (!gpu) return false

    const adapter = await gpu.requestAdapter()
    if (!adapter) return false

    const device = await adapter.requestDevice()
    if (!device) return false

    // 成功获取设备，释放资源
    device.destroy()
    return true
  } catch {
    return false
  }
}

/**
 * 创建 WebGPU 渲染器
 */
async function createWebGPURenderer(config: RendererConfig): Promise<UniversalRenderer | null> {
  try {
    // 动态导入 WebGPURenderer（避免在不支持的环境中报错）
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - three/webgpu types require bundler moduleResolution
    const webgpuModule = await import('three/webgpu')
    const WebGPURenderer = webgpuModule.default || webgpuModule.WebGPURenderer

    const renderer = new WebGPURenderer({
      antialias: config.antialias !== false,
      alpha: config.alpha,
      canvas: config.canvas
    })

    // 等待 WebGPU 初始化完成
    await renderer.init()

    console.log('✓ WebGPU 渲染器初始化成功')
    return renderer
  } catch (error) {
    console.warn('WebGPU 渲染器创建失败，将降级到 WebGL:', error)
    return null
  }
}

/**
 * 创建 WebGL 渲染器（fallback）
 */
function createWebGLRenderer(config: RendererConfig): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: config.antialias !== false,
    alpha: config.alpha ?? true,
    preserveDrawingBuffer: config.preserveDrawingBuffer ?? true,
    canvas: config.canvas
  })

  console.log('✓ WebGL 渲染器初始化成功')
  return renderer
}

/**
 * 创建最佳渲染器（自动检测 + 降级）
 *
 * @param config 渲染器配置
 * @param preferWebGPU 是否优先使用 WebGPU（默认 true）
 * @returns 渲染器实例和类型标识
 */
export async function createRenderer(
  config: RendererConfig = {},
  preferWebGPU = true
): Promise<RendererResult> {
  // 尝试使用 WebGPU
  if (preferWebGPU) {
    const gpuAvailable = await isWebGPUAvailable()

    if (gpuAvailable) {
      const webgpuRenderer = await createWebGPURenderer(config)
      if (webgpuRenderer) {
        return { renderer: webgpuRenderer, type: 'webgpu' }
      }
    }
  }

  // Fallback 到 WebGL
  const webglRenderer = createWebGLRenderer(config)
  return { renderer: webglRenderer, type: 'webgl' }
}

/**
 * 判断渲染器是否为 WebGPU 类型
 */
export function isWebGPURenderer(renderer: UniversalRenderer): boolean {
  // WebGPURenderer 没有 extensions 属性，WebGLRenderer 有
  return renderer && !('extensions' in renderer)
}

/**
 * 配置渲染器通用属性
 */
export function configureRenderer(
  renderer: UniversalRenderer,
  type: RendererType,
  options: {
    width: number
    height: number
    pixelRatio?: number
    shadowMapEnabled?: boolean
    toneMapping?: THREE.ToneMapping
    toneMappingExposure?: number
    outputColorSpace?: THREE.ColorSpace
  }
): void {
  renderer.setSize(options.width, options.height)
  renderer.setPixelRatio(Math.min(options.pixelRatio ?? window.devicePixelRatio, 2))
  renderer.outputColorSpace = options.outputColorSpace ?? THREE.SRGBColorSpace
  // CAD 视图使用 NoToneMapping 保证颜色准确，避免 ACES 在 WebGPU 下的兼容问题
  renderer.toneMapping = options.toneMapping ?? THREE.NoToneMapping
  renderer.toneMappingExposure = options.toneMappingExposure ?? 1.0

  if (type === 'webgl') {
    const glRenderer = renderer as THREE.WebGLRenderer
    glRenderer.shadowMap.enabled = options.shadowMapEnabled ?? true
    glRenderer.shadowMap.type = THREE.PCFSoftShadowMap
  } else {
    // WebGPU 渲染器的阴影配置
    if (options.shadowMapEnabled !== false && renderer.shadowMap) {
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.VSMShadowMap
    }
  }
}

/**
 * 安全截图（处理 WebGPU/WebGL 差异）
 */
export function takeScreenshot(renderer: UniversalRenderer, scene: THREE.Scene, camera: THREE.Camera): string {
  // 强制渲染一帧
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
