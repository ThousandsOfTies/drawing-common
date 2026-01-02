// Types
export type { DrawingPath, DrawingPoint, DrawingConfig, DrawingHistory, ToolType, SelectionState } from './types'

// Hooks
export { useDrawing, isScratchPattern, doPathsIntersect } from './hooks/useDrawing'
export { useEraser } from './hooks/useEraser'
export { useZoomPan } from './hooks/useZoomPan'
export { useLassoSelection } from './hooks/useLassoSelection'

// Components
export { DrawingCanvas, type DrawingCanvasProps } from './components/DrawingCanvas'

