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

/**
 * 選択状態
 */
export interface SelectionState {
  /** 選択に使用したラッソのパス */
  lassoPath: DrawingPath | null
  /** 選択されたパスのインデックス */
  selectedIndices: number[]
  /** バウンディングボックス（正規化座標） */
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null
  /** ドラッグ中か */
  isDragging: boolean
  /** ドラッグ開始位置 */
  dragStart: DrawingPoint | null
}
