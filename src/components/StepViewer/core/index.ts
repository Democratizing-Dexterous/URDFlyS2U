/**
 * 核心模块导出
 */

export { StepLoader, preloadOcct, isOcctLoaded, terminateWorker } from './StepLoader'
export { SceneManager } from './SceneManager'
export { SelectionManager } from './SelectionManager'
export { FeatureDetector } from './FeatureDetector'
export { AuxiliaryVisualizer } from './AuxiliaryVisualizer'
export { MeasurementTool } from './MeasurementTool'
export { LineMeasurementTool } from './LineMeasurementTool'
export { FrameVisualizer } from './FrameVisualizer'
export { ForwardKinematics } from './ForwardKinematics'
export { JointSnapVisualizer } from './JointSnapVisualizer'
export { serializeURDF, deserializeURDF } from './URDFSerializer'
export {
  createRenderer,
  isWebGPUAvailable,
  isWebGPURenderer,
  configureRenderer,
  takeScreenshot
} from './RendererFactory'

export type { SceneManagerConfig } from './SceneManager'
export type { SelectionManagerConfig, SelectionEvent } from './SelectionManager'
export type { AuxiliaryVisualizerConfig } from './AuxiliaryVisualizer'
export type { MeasurementToolConfig } from './MeasurementTool'
export type { LineMeasurementToolConfig, LineMeasurementData } from './LineMeasurementTool'
export type { RendererType, UniversalRenderer, RendererConfig, RendererResult } from './RendererFactory'
export type { InertiaWorkerApi } from './InertiaWorker'
export type { ExportWorkerApi } from './ExportWorker'
export type { KinematicsWorkerApi } from './KinematicsWorker'
export type { JointSnapVisualizerConfig } from './JointSnapVisualizer'
