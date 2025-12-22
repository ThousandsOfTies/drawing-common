// Types
export type { DrawingPath, DrawingPoint, DrawingConfig, DrawingHistory, ToolType } from './types'

// Hooks
export { useDrawing, isScratchPattern, doPathsIntersect } from './hooks/useDrawing'
export { useEraser } from './hooks/useEraser'
export { useZoomPan } from './hooks/useZoomPan'

// Components
export { DrawingCanvas, type DrawingCanvasProps } from './components/DrawingCanvas'
