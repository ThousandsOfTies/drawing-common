// Types
export type { DrawingPath, DrawingPoint, DrawingConfig, DrawingHistory, ToolType, StrokeStyle, SelectionState, DrawingCanvasHandle } from './types'

// Hooks
export { useDrawing, isScratchPattern, doPathsIntersect } from './hooks/useDrawing'
export { useEraser } from './hooks/useEraser'
export { useZoomPan } from './hooks/useZoomPan'
export { useLassoSelection } from './hooks/useLassoSelection'

// Components
export { DrawingCanvas, type DrawingCanvasProps } from './components/DrawingCanvas'
export { drawAdditionalStrokeStyle } from './rendering/drawAdditionalStrokeStyle'
export { CanvasUndoHistory } from './history/CanvasUndoHistory'
export { zoomAtPoint, touchPair, pinchViewport, type Point, type Viewport, type PinchGesture } from './geometry/viewport'
