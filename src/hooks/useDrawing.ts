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
import type { DrawingPath, DrawingCanvasHandle } from '../types'

// 速度がまだ測れない描き始めと、PointerUp直前の描き終わりに使う細さ。
const BRUSH_ENDPOINT_FACTOR = 0.08
const BRUSH_TAPER_DISTANCE_MULTIPLIER = 2

interface UseDrawingOptions {
  width: number
  color: string
  opacity?: number
  style?: 'pencil' | 'marker' | 'brush'
  onPathPreview?: (path: DrawingPath | null) => void
  onPathComplete?: (path: DrawingPath) => void
  // スクラッチ完了時のコールバック（交差したパスを削除するため）
  onScratchComplete?: (scratchPath: DrawingPath) => void
  // 既存パスを取得する関数（スクラッチ判定時に交差チェック用）
  getCurrentPaths?: () => DrawingPath[]

}

export const useDrawing = (
  // DrawingCanvasHandle を受け取る
  canvasRef: React.RefObject<DrawingCanvasHandle | null>,
  options: UseDrawingOptions
) => {
  const [isDrawing, setIsDrawing] = useState(false)
  const currentPathRef = useRef<DrawingPath | null>(null)

  // バッチ間で最後の描画座標を保持（丸め誤差回避）
  const lastCanvasCoordRef = useRef<{ x: number, y: number } | null>(null)
  const lastWidthSampleRef = useRef<{ x: number, y: number, time: number } | null>(null)
  const smoothedSpeedRef = useRef<number | null>(null)
  const brushSpeedSampleCountRef = useRef(0)

  const getPointWidth = (x: number, y: number, pressure?: number, time = performance.now()) => {
    if (options.style === 'pencil') return Math.max(1, options.width * 0.7)
    if (options.style === 'marker') return options.width * 1.15
    if (options.style !== 'brush') return options.width
    const previous = lastWidthSampleRef.current

    // 最初の点は速度が測れない。0px/ms（最も太い）として扱わず、
    // 描き始めだけ不自然に太くなるのを避ける。
    if (!previous) {
      lastWidthSampleRef.current = { x, y, time }
      smoothedSpeedRef.current = null
      brushSpeedSampleCountRef.current = 0
      return Math.max(1, options.width * BRUSH_ENDPOINT_FACTOR)
    }

    const rawSpeed = Math.hypot(x - previous.x, y - previous.y) / Math.max(1, time - previous.time)
    // イベント間隔や coalesced event のばらつきで線幅が跳ねないように平滑化する。
    const speed = smoothedSpeedRef.current === null
      ? rawSpeed
      : smoothedSpeedRef.current * 0.65 + rawSpeed * 0.35
    lastWidthSampleRef.current = { x, y, time }
    smoothedSpeedRef.current = speed

    // 最初の線分は丸い lineCap が開始位置まで広がるため、速度が測れても
    // すぐに太くしない。短い助走を細く保ち、描き始めの丸を抑える。
    if (brushSpeedSampleCountRef.current++ === 0) {
      return Math.max(1, options.width * BRUSH_ENDPOINT_FACTOR)
    }

    // 筆圧が使える端末では優先し、マウス・指では速度で自然な強弱を付ける。
    const factor = pressure && pressure > 0 && pressure < 1
      ? 0.3 + pressure * 0.9
      // ゆっくり動かしたときは設定幅より太く、速く動かしたときは細くする。
      : Math.max(0.4, Math.min(1.3, 1.3 - speed * 0.18))
    return Math.max(1, options.width * factor)
  }

  // ヘルパー：Canvasサイズ取得
  const getCanvasSize = (): { width: number, height: number } | null => {
    const current = canvasRef.current
    if (!current) return null
    return current.getSize()
  }

  const createDisplayPath = (source: DrawingPath, size: { width: number, height: number }): DrawingPath => {
    const path: DrawingPath = { ...source, points: source.points.map(point => ({ ...point })) }
    if (path.style !== 'brush') return path

    const endpointWidth = Math.max(1, options.width * BRUSH_ENDPOINT_FACTOR)
    const taperDistance = Math.max(options.width * BRUSH_TAPER_DISTANCE_MULTIPLIER, 24)
    const originalWidths = path.points.map(point => point.width ?? options.width)
    const taperProgress = path.points.map(() => 1)
    const applyTaperFrom = (startIndex: number, step: 1 | -1) => {
      let distance = 0
      for (let i = startIndex; i >= 0 && i < path.points.length; i += step) {
        if (i !== startIndex) {
          const previous = path.points[i - step]
          const current = path.points[i]
          distance += Math.hypot(
            (current.x - previous.x) * size.width,
            (current.y - previous.y) * size.height
          )
        }
        taperProgress[i] = Math.min(taperProgress[i], Math.min(1, distance / taperDistance))
        if (distance >= taperDistance) break
      }
    }
    applyTaperFrom(0, 1)
    applyTaperFrom(path.points.length - 1, -1)
    path.points.forEach((point, index) => {
      point.width = endpointWidth + (originalWidths[index] - endpointWidth) * taperProgress[index]
    })
    return path
  }

  const updatePreview = (size: { width: number, height: number }) => {
    if (!options.onPathPreview || !currentPathRef.current) return
    options.onPathPreview(createDisplayPath(currentPathRef.current, size))
  }

  // ヘルパー：描画実行
  const executeDraw = (points: { x: number, y: number }[], width = options.width) => {
    if (options.onPathPreview) return
    const current = canvasRef.current
    if (!current) return
    current.drawStroke(points, options.color, width, options.opacity)
  }

  const startDrawing = (x: number, y: number, pressure?: number, time?: number) => {
    const size = getCanvasSize()
    if (!size) return

    setIsDrawing(true)

    // 正規化座標で保存（0-1の範囲）
    const normalizedX = x / size.width
    const normalizedY = y / size.height

    currentPathRef.current = {
      points: [{ x: normalizedX, y: normalizedY, width: getPointWidth(x, y, pressure, time) }],
      color: options.color,
      width: options.width,
      opacity: options.opacity,
      style: options.style
    }

    // 最初の点のcanvas座標を保存
    lastCanvasCoordRef.current = { x, y }
    updatePreview(size)
  }

  const draw = (x: number, y: number) => {
    const size = getCanvasSize()
    if (!isDrawing || !currentPathRef.current || !size) return

    // 正規化
    const normalizedX = x / size.width
    const normalizedY = y / size.height

    // 今回追加するポイントのリスト
    const newPoints: { x: number, y: number, width?: number }[] = []

    // マウス等の低サンプリングレート入力のために補間を行う
    const path = currentPathRef.current
    const lastPoint = path.points[path.points.length - 1]

    if (lastPoint) {
      const dx = normalizedX - lastPoint.x
      const dy = normalizedY - lastPoint.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      // キャンバスサイズに対する相対的な閾値（例: 5px相当）
      const threshold = 5 / Math.min(size.width, size.height)

      if (dist > threshold) {
        const steps = Math.min(10, Math.floor(dist / (threshold / 2))) // 最大10分割まで
        for (let i = 1; i < steps; i++) {
          const t = i / steps
          newPoints.push({
            x: lastPoint.x + dx * t,
            y: lastPoint.y + dy * t,
            width: getPointWidth(
              (lastPoint.x + dx * t) * size.width,
              (lastPoint.y + dy * t) * size.height
            )
          })
        }
      }
    }

    // 実際のタッチ/マウス位置を追加
    newPoints.push({ x: normalizedX, y: normalizedY, width: getPointWidth(x, y) })

    // ポイントを順次追加
    for (const point of newPoints) {
      path.points.push(point)
    }

    let prevX = path.points[path.points.length - 1 - newPoints.length].x * size.width
    let prevY = path.points[path.points.length - 1 - newPoints.length].y * size.height
    let previousWidth = path.points[path.points.length - 1 - newPoints.length].width ?? options.width

    for (const point of newPoints) {
      const currX = point.x * size.width
      const currY = point.y * size.height
      const currentWidth = point.width ?? options.width

      executeDraw([{ x: prevX, y: prevY }, { x: currX, y: currY }], (previousWidth + currentWidth) / 2)

      prevX = currX
      prevY = currY
      previousWidth = currentWidth
    }
    updatePreview(size)
  }

  /**
   * Coalesced Events用の一括描画メソッド
   * シンプルな順次描画: 前回の最後の点 → 新しい点たちを順番に接続
   * @param points 正規化されていない座標の配列 (canvas width/height で割る前)
   */
  const drawBatch = (points: Array<{ x: number, y: number, pressure?: number, time?: number }>) => {
    const size = getCanvasSize()
    const path = currentPathRef.current

    if (!isDrawing || !path || !size || points.length === 0) return

    // 重複バッチ検出: 前回最終点と今回最終点が同じなら二度呼びと判断してスキップ
    if (lastCanvasCoordRef.current && points.length > 0) {
      const lastPoint = points[points.length - 1]
      if (lastPoint.x === lastCanvasCoordRef.current.x &&
        lastPoint.y === lastCanvasCoordRef.current.y) {
        return  // 重複バッチをスキップ
      }
    }

    // 正規化座標に変換して path.points に追加
    points.forEach(p => {
      path.points.push({
        x: p.x / size.width,
        y: p.y / size.height,
        width: getPointWidth(p.x, p.y, p.pressure, p.time)
      })
    })

    // 描画用のローカル配列を構築
    // 前回の最後の点があれば最初に追加（バッチ間接続のため）
    const localPoints: Array<{ x: number, y: number }> = []
    if (lastCanvasCoordRef.current) {
      localPoints.push(lastCanvasCoordRef.current)
    }
    localPoints.push(...points)

    // 各入力点の幅で直ちに線分を描く。リリース後の再描画を待たない。
    for (let i = 1; i < localPoints.length; i++) {
      const currentPointIndex = Math.max(0, path.points.length - points.length + i - 1)
      const previousPointIndex = Math.max(0, currentPointIndex - 1)
      const previousWidth = path.points[previousPointIndex]?.width ?? options.width
      const currentWidth = path.points[currentPointIndex]?.width ?? options.width
      // 確定後の再描画と同じく、線分の両端の平均幅で描画する。
      executeDraw([localPoints[i - 1], localPoints[i]], (previousWidth + currentWidth) / 2)
    }

    // 最後の点を保存（次のバッチとの接続用）
    if (points.length > 0) {
      lastCanvasCoordRef.current = {
        x: points[points.length - 1].x,
        y: points[points.length - 1].y
      }
    }
    updatePreview(size)
  }

  const stopDrawing = () => {
    if (isDrawing && currentPathRef.current) {
      const newPath = currentPathRef.current
      const widthsBeforeEndpointTaper = newPath.points.map(point => point.width ?? options.width)

      const size = getCanvasSize()
      if (size) newPath.points = createDisplayPath(newPath, size).points

      // 開発時の描画診断用。速度由来の幅と端点補正のどちらが効いているかを確認する。
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        const widths = newPath.points.map(point => point.width ?? options.width)
        const middle = Math.floor(widths.length / 2)
        console.info('[CopiCopi stroke]', {
          style: newPath.style,
          opacity: newPath.opacity,
          baseWidth: options.width,
          pointCount: widths.length,
          beforeTaper: {
            start: widthsBeforeEndpointTaper[0],
            middle: widthsBeforeEndpointTaper[Math.floor(widthsBeforeEndpointTaper.length / 2)],
            end: widthsBeforeEndpointTaper[widthsBeforeEndpointTaper.length - 1]
          },
          final: { start: widths[0], middle: widths[middle], end: widths[widths.length - 1] },
          range: { min: Math.min(...widths), max: Math.max(...widths) }
        })
      }

      const isScratch = isScratchPattern(newPath)

      currentPathRef.current = null
      lastCanvasCoordRef.current = null  // CRITICAL: Reset for next stroke
      lastWidthSampleRef.current = null
      smoothedSpeedRef.current = null
      brushSpeedSampleCountRef.current = 0
      setIsDrawing(false)
      options.onPathPreview?.(null)

      // 描画中のプレビューを先に消してから確定パスを追加する。
      // 同じレンダリングサイクルで追加すると、太いプレビューの上に最終線を
      // 重ねてしまい、保存データより太く見えることがある。
      window.setTimeout(() => {
        if (isScratch) {
          options.onScratchComplete?.(newPath)
        } else {
          options.onPathComplete?.(newPath)
        }
      }, 0)
    }
  }

  /**
   * 描画をキャンセル（パスを保存せずにリセット）
   * なげなわ選択モード発動時などに使用
   */
  const cancelDrawing = () => {
    currentPathRef.current = null

    lastCanvasCoordRef.current = null  // CRITICAL: Reset for next stroke
    lastWidthSampleRef.current = null
    smoothedSpeedRef.current = null
    brushSpeedSampleCountRef.current = 0
    setIsDrawing(false)
    options.onPathPreview?.(null)
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
