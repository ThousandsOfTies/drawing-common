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
      const points = path.points
      const len = points.length

      if (len < 2) continue

      if (len < 3) {
        // 点が2つの場合は直線
        ctx.beginPath()
        ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height)
        ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height)
        ctx.stroke()
      } else {
        // 3点以上の場合はベジェ曲線で滑らかに
        // 今回追加された点(p2: len-1)に向かって、p0(len-3)p1(len-2)を使って描画
        const p0 = points[len - 3]
        const p1 = points[len - 2]
        const p2 = points[len - 1]

        // 制御点を中間点に設定
        const cpX = p1.x * canvas.width
        const cpY = p1.y * canvas.height
        const endX = (p1.x + p2.x) / 2 * canvas.width
        const endY = (p1.y + p2.y) / 2 * canvas.height

        ctx.beginPath()
        if (len === 3) {
          ctx.moveTo(p0.x * canvas.width, p0.y * canvas.height)
        } else {
          const prevEndX = (p0.x + p1.x) / 2 * canvas.width
          const prevEndY = (p0.y + p1.y) / 2 * canvas.height
          ctx.moveTo(prevEndX, prevEndY)
        }
        ctx.quadraticCurveTo(cpX, cpY, endX, endY)
        ctx.stroke()
      }
    }
  }

  /**
   * Coalesced Events用の一括描画メソッド
   * 複数のポイントを受け取り、補間の重複を避けながら一度に描画
   * @param points 正規化されていない座標の配列 (canvas width/height で割る前)
   */
  const drawBatch = (points: Array<{ x: number, y: number }>) => {
    const canvas = canvasRef.current

    if (!isDrawing || !currentPathRef.current || !ctxRef.current || !canvas || points.length === 0) {
      return
    }

    const path = currentPathRef.current

    const normalizedPoints = points.map(p => ({
      x: p.x / canvas.width,
      y: p.y / canvas.height
    }))

    const ctx = ctxRef.current!

    // Coalesced Eventsからの入力は高精細なので補間は不要
    // 単純にポイントを追加し、描画ロジックを回す
    const allNewPoints = normalizedPoints
    // ポイントをまとめて追加（重複除外）
    // ムラ防止のため、フィルタを少し強める (0.5px -> 1.5px)
    const minDistance = 1.5 / Math.min(canvas.width, canvas.height)
    const oldLength = path.points.length

    for (const point of allNewPoints) {
      const currentLast = path.points[path.points.length - 1]
      // 重複・ノイズ除去
      if (currentLast) {
        const dx = point.x - currentLast.x
        const dy = point.y - currentLast.y
        if (Math.sqrt(dx * dx + dy * dy) < minDistance) {
          continue
        }
      }
      path.points.push(point)
    }

    const newLength = path.points.length
    if (newLength === oldLength) return

    // 描画ループ
    const startIdx = Math.max(1, oldLength)

    for (let i = startIdx; i < newLength; i++) {
      const points = path.points

      if (i === 1) {
        // i=1: 最初の直線 (p0-p1)
        // すでに3点以上あるなら、i=2でp0からの曲線を描くのでここはスキップ
        if (newLength > 2) {
          continue
        }

        ctx.beginPath()
        ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height)
        ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height)
        ctx.stroke()
      } else {
        // i >= 2: 曲線 (p0-p1-p2)
        const p0 = points[i - 2]
        const p1 = points[i - 1]
        const p2 = points[i]

        const cpX = p1.x * canvas.width
        const cpY = p1.y * canvas.height
        const endX = (p1.x + p2.x) / 2 * canvas.width
        const endY = (p1.y + p2.y) / 2 * canvas.height

        ctx.beginPath()
        if (i === 2) {
          // 最初の曲線セグメント

          // ケース1: 以前のバッチで [p0, p1] の直線を描画済みの場合 (oldLength === 2)
          // p0からカーブを描くと、既存の直線 p0-p1 と重なって「二重線」や「弦（ショートカット）」のような
          // アーティファクトが発生する。
          // そのため、描画済みの p1 から開始し、p1 -> mid(p1, p2) への接続を描く。
          if (oldLength === 2) {
            ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height)
          }
          // ケース2: 今回のバッチで p0, p1, p2... と一気に描く場合
          // まだ何も描画されていないので、p0 から滑らかな曲線をスタートさせる。
          else {
            ctx.moveTo(p0.x * canvas.width, p0.y * canvas.height)
          }
        } else {
          // 中間のセグメント
          const prevEndX = (p0.x + p1.x) / 2 * canvas.width
          const prevEndY = (p0.y + p1.y) / 2 * canvas.height
          ctx.moveTo(prevEndX, prevEndY)
        }

        ctx.quadraticCurveTo(cpX, cpY, endX, endY)
        ctx.stroke()
      }
    }
  }

  const stopDrawing = () => {
    if (isDrawing && currentPathRef.current) {
      const newPath = currentPathRef.current
      const canvas = canvasRef.current
      const ctx = ctxRef.current

      // ポイントが2つだけで終了した場合（直線）
      // drawBatchでは二重線防止のために描画をスキップしているので、ここで描画する
      if (newPath.points.length === 2 && canvas && ctx) {
        const p0 = newPath.points[0]
        const p1 = newPath.points[1]
        ctx.beginPath()
        ctx.moveTo(p0.x * canvas.width, p0.y * canvas.height)
        ctx.lineTo(p1.x * canvas.width, p1.y * canvas.height)
        ctx.stroke()
      }

      // TEMPORARY: Disable scratch pattern detection due to false positives
      // TODO: Fix scratch pattern detection logic for drawBatch-drawn paths
      /*
      if (isScratchPattern(newPath)) {
        if (options.onScratchComplete) {
          options.onScratchComplete(newPath)
        }
      } else {
        if (options.onPathComplete) {
          options.onPathComplete(newPath)
        }
      }
      */

      // Always call onPathComplete (scratch pattern detection disabled)
      if (options.onPathComplete) {
        options.onPathComplete(newPath)
      }
    }

    currentPathRef.current = null
    ctxRef.current = null
    setIsDrawing(false)
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

