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
export const doPathsIntersect = (path1: DrawingPath, path2: DrawingPath): boolean => {
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
export const isScratchPattern = (path: DrawingPath): boolean => {
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
    // 閾値を下げて高ズーム時も検出可能に（500%以上対応）
    if (distance < 0.0001) continue


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
  // スクラッチ完了時のコールバック（交差したパスを削除するため）
  onScratchComplete?: (scratchPath: DrawingPath) => void
  // 既存パスを取得する関数（スクラッチ判定時に交差チェック用）
  getCurrentPaths?: () => DrawingPath[]
  // デバッグ用ログコールバック（iPadでの可視化）
  onLog?: (message: string, data?: any) => void
}

export const useDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: UseDrawingOptions
) => {
  const [isDrawing, setIsDrawing] = useState(false)
  const currentPathRef = useRef<DrawingPath | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // バッチ間で最後の描画座標を保持（丸め誤差回避）
  const lastCanvasCoordRef = useRef<{ x: number, y: number } | null>(null)

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

    // 最初の点のcanvas座標を保存
    lastCanvasCoordRef.current = { x, y }

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

    // 今回追加するポイントのリスト
    const newPoints: { x: number, y: number }[] = []

    // マウス等の低サンプリングレート入力のために補間を行う
    const path = currentPathRef.current
    const lastPoint = path.points[path.points.length - 1]

    if (lastPoint) {
      const dx = normalizedX - lastPoint.x
      const dy = normalizedY - lastPoint.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      // キャンバスサイズに対する相対的な閾値（例: 5px相当）
      const threshold = 5 / Math.min(canvas.width, canvas.height)

      if (dist > threshold) {
        const steps = Math.min(10, Math.floor(dist / (threshold / 2))) // 最大10分割まで
        for (let i = 1; i < steps; i++) {
          const t = i / steps
          newPoints.push({
            x: lastPoint.x + dx * t,
            y: lastPoint.y + dy * t
          })
        }
      }
    }

    // 実際のタッチ/マウス位置を追加
    newPoints.push({ x: normalizedX, y: normalizedY })

    // ポイントを順次追加して描画
    const ctx = ctxRef.current


    for (const point of newPoints) {
      path.points.push(point)
      const len = path.points.length

      if (len < 2) continue

      // シンプルなLineTo描画（drawBatchと同じロジック）
      const prevPt = path.points[len - 2]
      const currPt = path.points[len - 1]

      ctx.beginPath()
      ctx.moveTo(prevPt.x * canvas.width, prevPt.y * canvas.height)
      ctx.lineTo(currPt.x * canvas.width, currPt.y * canvas.height)
      ctx.stroke()
    }
  }


  /**
   * Coalesced Events用の一括描画メソッド
   * 複数のポイントを受け取り、補間の重複を避けながら一度に描画
   * @param points 正規化されていない座標の配列 (canvas width/height で割る前)
   */
  const drawBatch = (points: Array<{ x: number, y: number }>) => {
    // バージョン識別用ログ
    if (Math.random() < 0.01) console.log('useDrawing v0.2.14.l81 - Canvas Coord Cache Fix')

    const canvas = canvasRef.current

    if (!isDrawing || !currentPathRef.current || !ctxRef.current || !canvas || points.length === 0) {
      return
    }

    const ctx = ctxRef.current
    let path = currentPathRef.current

    // 正規化座標に変換
    const normalizedPoints = points.map(p => ({
      x: p.x / canvas.width,
      y: p.y / canvas.height
    }))


    // **診断テスト: バッチ間の接続を無効化**
    // バッチ内だけで線を繋ぐ
    let lastCanvasX: number | null = null
    let lastCanvasY: number | null = null


    // バッチ内の各点を順次処理してLineTo描画
    for (let i = 0; i < normalizedPoints.length; i++) {
      const point = normalizedPoints[i]
      const canvasX = points[i].x  // 元のcanvas座標を使用（丸め誤差なし）
      const canvasY = points[i].y

      path.points.push(point)

      if (lastCanvasX === null || lastCanvasY === null) {
        // 最初の点はmoveToのみ
        lastCanvasX = canvasX
        lastCanvasY = canvasY
        continue
      }

      // iPad可視ログ（最初の20点まで拡大）
      if (i < 20 && options.onLog) {
        const len = path.points.length
        options.onLog(`[DB${i}]`, `len=${len} M(${lastCanvasX.toFixed(0)},${lastCanvasY.toFixed(0)}) L(${canvasX.toFixed(0)},${canvasY.toFixed(0)})`)
      }

      ctx.beginPath()
      ctx.moveTo(lastCanvasX, lastCanvasY)
      ctx.lineTo(canvasX, canvasY)
      ctx.stroke()

      // 次の線のために現在の点を保存（ローカル変数とRef両方）
      lastCanvasX = canvasX
      lastCanvasY = canvasY
      lastCanvasCoordRef.current = { x: canvasX, y: canvasY }
    }
  }

  const stopDrawing = () => {
    if (isDrawing && currentPathRef.current) {
      const newPath = currentPathRef.current

      // TEMPORARY: Disable scratch pattern detection due to false positives
      // TODO: Fix scratch pattern detection logic for drawBatch-drawn paths
      // if (isScratchPattern(newPath)) {
      //   // スクラッチの場合はonScratchCompleteを呼び出す
      //   if (options.onScratchComplete) {
      //     options.onScratchComplete(newPath)
      //   }
      //   // スクラッチ自体は保存しない（onPathCompleteは呼ばない）
      // } else {
      //   // 通常の描画の場合
      //   if (options.onPathComplete) {
      //     options.onPathComplete(newPath)
      //   }
      // }

      // Always call onPathComplete (scratch pattern detection disabled)
      if (options.onPathComplete) {
        options.onPathComplete(newPath)
      }

      currentPathRef.current = null
      ctxRef.current = null
      setIsDrawing(false)
    }
  }

  /**
   * 描画をキャンセル（パスを保存せずにリセット）
   * なげなわ選択モード発動時などに使用
   */
  const cancelDrawing = () => {
    currentPathRef.current = null
    ctxRef.current = null
    setIsDrawing(false)
  }

  return {
    isDrawing,
    startDrawing,
    draw, // 名前変更 continueDrawing -> draw
    drawBatch, // Coalesced Events用
    stopDrawing,
    cancelDrawing
  }
}

