

// 線分の交差判定
const doSegmentsIntersect = (
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean => {
  const ccw = (A: { x: number; y: number }, B: { x: number; y: number }, C: { x: number; y: number }) => {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x)
  }
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}

// パス同士が交差しているか判定
const doPathsIntersect = (path1: DrawingPath, path2: DrawingPath): boolean => {
  // パス1の各線分とパス2の各線分を比較
  for (let i = 0; i < path1.points.length - 1; i++) {
    for (let j = 0; j < path2.points.length - 1; j++) {
      if (doSegmentsIntersect(
        path1.points[i],
        path1.points[i + 1],
        path2.points[j],
        path2.points[j + 1]
      )) {
        return true
      }
    }
  }
  return false
}

// スクラッチパターンを検出（往復する動きを検出）
const isScratchPattern = (path: DrawingPath): boolean => {
  const points = path.points

  // 最低15ポイント必要（短すぎる線はスクラッチではない）
  if (points.length < 15) return false

  // 進行方向の角度を計算し、方向転換の回数を数える
  let directionChanges = 0
  let prevAngle: number | null = null

  for (let i = 2; i < points.length; i++) {
    const dx = points[i].x - points[i - 2].x
    const dy = points[i].y - points[i - 2].y
    const distance = Math.sqrt(dx * dx + dy * dy)

    // 距離が短すぎる場合はスキップ（ノイズ除去）
    if (distance < 0.005) continue

    const angle = Math.atan2(dy, dx)

    if (prevAngle !== null) {
      // 角度の差を計算（-π ～ π の範囲に正規化）
      let angleDiff = angle - prevAngle
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

      // 90度以上の方向転換をカウント
      if (Math.abs(angleDiff) > Math.PI / 2) {
        directionChanges++
      }
    }

    prevAngle = angle
  }

  // 2往復 = 約4回以上の方向転換
  return directionChanges >= 4
}

// useDrawing.ts
import { useRef, useState } from 'react'
import type { DrawingPath } from '../types'

interface UseDrawingOptions {
  width: number
  color: string
  onPathComplete?: (path: DrawingPath) => void
}

export const useDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: UseDrawingOptions
) => {
  const [isDrawing, setIsDrawing] = useState(false)
  const currentPathRef = useRef<DrawingPath | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  const startDrawing = (x: number, y: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    setIsDrawing(true)

    // 正規化座標で保存（0-1の範囲）
    const normalizedX = x / canvas.width
    const normalizedY = y / canvas.height

    currentPathRef.current = {
      points: [{ x: normalizedX, y: normalizedY }],
      color: options.color,
      width: options.width
    }

    // contextをキャッシュし、スタイルを一度だけ設定
    ctxRef.current = canvas.getContext('2d')!
    ctxRef.current.strokeStyle = options.color
    ctxRef.current.lineWidth = options.width
    ctxRef.current.lineCap = 'round'
    ctxRef.current.lineJoin = 'round'
  }

  const draw = (x: number, y: number) => {
    const canvas = canvasRef.current
    if (!isDrawing || !currentPathRef.current || !ctxRef.current || !canvas) return

    // 正規化
    const normalizedX = x / canvas.width
    const normalizedY = y / canvas.height

    // すべての点を保存（間引きなし - Apple Pencilの高速描画に対応）
    currentPathRef.current.points.push({ x: normalizedX, y: normalizedY })

    const points = currentPathRef.current.points
    if (points.length < 2) return

    // キャッシュされたcontextを使用
    const ctx = ctxRef.current
    const len = points.length

    // 描画ロジック（直近の数点だけを描画して高速化）
    // Canvas上の座標に変換
    const p1 = points[len - 2]
    const p2 = points[len - 1]
    const x1 = p1.x * canvas.width
    const y1 = p1.y * canvas.height
    const x2 = p2.x * canvas.width
    const y2 = p2.y * canvas.height

    if (len === 2) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    } else {
      // 3点以上ある場合、直前の区間を二次ベジェ曲線で描画
      const p0 = points[len - 3]
      const x0 = p0.x * canvas.width
      const y0 = p0.y * canvas.height

      // 中点を制御点とする簡易スムージング
      const mid1x = (x0 + x1) / 2
      const mid1y = (y0 + y1) / 2
      const mid2x = (x1 + x2) / 2
      const mid2y = (y1 + y2) / 2

      ctx.beginPath()
      ctx.moveTo(mid1x, mid1y)
      ctx.quadraticCurveTo(x1, y1, mid2x, mid2y)
      ctx.stroke()
    }
  }

  const stopDrawing = () => {
    if (isDrawing && currentPathRef.current) {
      if (options.onPathComplete) {
        options.onPathComplete(currentPathRef.current)
      }
      currentPathRef.current = null
      ctxRef.current = null
      setIsDrawing(false)
    }
  }

  return {
    isDrawing,
    startDrawing,
    draw, // 名前変更 continueDrawing -> draw
    stopDrawing
  }
}
