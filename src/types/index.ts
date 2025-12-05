/**
 * 描画ツールの種類
 */
export type ToolType = 'pen' | 'eraser' | 'selection'

/**
 * 描画パスの点
 */
export interface DrawingPoint {
  x: number
  y: number
}

/**
 * 描画パス
 */
export interface DrawingPath {
  points: DrawingPoint[]
  color: string
  width: number
  tool: 'pen' | 'eraser'
}

/**
 * 描画設定
 */
export interface DrawingConfig {
  penColor: string
  penSize: number
  eraserSize: number
}

/**
 * 描画履歴
 */
export interface DrawingHistory {
  paths: DrawingPath[]
  index: number
}
