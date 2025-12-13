// useEraser.ts
import { useState } from 'react'
import type { DrawingPath } from '../types'

export const useEraser = (
  eraserSize: number,
  onPathsChange: (paths: DrawingPath[]) => void
) => {
  const [isErasing, setIsErasing] = useState(false)
  const [lastErasePos, setLastErasePos] = useState<{ x: number; y: number } | null>(null)

  const startErasing = () => {
    setIsErasing(true)
    setLastErasePos(null)
  }

  const eraseAtPosition = (
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    currentPaths: DrawingPath[]
  ) => {
    // 前回と同じ位置なら処理をスキップ（パフォーマンス向上）
    if (lastErasePos && Math.abs(lastErasePos.x - x) < 1 && Math.abs(lastErasePos.y - y) < 1) {
      return
    }
    setLastErasePos({ x, y })

    // 消しゴムの位置に近いパスを全て探す
    const eraserRadiusPx = eraserSize
    const pathsToModify: Array<{ pathIndex: number; pointIndices: number[] }> = []

    for (let i = 0; i < currentPaths.length; i++) {
      const path = currentPaths[i]
      const pointIndices: number[] = []

      for (let j = 0; j < path.points.length; j++) {
        const point = path.points[j]
        // 正規化座標をピクセル座標に変換して距離を計算
        const pointXPx = point.x * canvas.width
        const pointYPx = point.y * canvas.height

        const distance = Math.sqrt(
          Math.pow(pointXPx - x, 2) + Math.pow(pointYPx - y, 2)
        )

        if (distance < eraserRadiusPx) {
          pointIndices.push(j)
        }
      }

      if (pointIndices.length > 0) {
        pathsToModify.push({ pathIndex: i, pointIndices })
      }
    }

    if (pathsToModify.length > 0) {
      let newPaths = [...currentPaths]

      // 後ろから処理してインデックスのずれを防ぐ
      for (let i = pathsToModify.length - 1; i >= 0; i--) {
        const { pathIndex, pointIndices } = pathsToModify[i]
        const path = newPaths[pathIndex]

        if (!path) continue

        // 連続する削除ポイントの範囲を特定
        const ranges: Array<[number, number]> = []
        let rangeStart = pointIndices[0]
        let rangeEnd = pointIndices[0]

        for (let j = 1; j < pointIndices.length; j++) {
          if (pointIndices[j] === rangeEnd + 1) {
            rangeEnd = pointIndices[j]
          } else {
            ranges.push([rangeStart, rangeEnd])
            rangeStart = pointIndices[j]
            rangeEnd = pointIndices[j]
          }
        }
        ranges.push([rangeStart, rangeEnd])

        // パスを分割
        const segments: DrawingPath[] = []
        let lastEnd = 0

        for (const [start, end] of ranges) {
          if (start > lastEnd) {
            const segmentPoints = path.points.slice(lastEnd, start)
            if (segmentPoints.length >= 2) {
              segments.push({
                points: segmentPoints,
                color: path.color,
                width: path.width
              })
            }
          }
          lastEnd = end + 1
        }

        // 最後のセグメント
        if (lastEnd < path.points.length) {
          const segmentPoints = path.points.slice(lastEnd)
          if (segmentPoints.length >= 2) {
            segments.push({
              points: segmentPoints,
              color: path.color,
              width: path.width
            })
          }
        }

        // 元のパスを削除して分割されたセグメントを追加
        newPaths.splice(pathIndex, 1, ...segments)
      }

      // 空のパスを削除
      newPaths = newPaths.filter(p => p.points.length >= 2)

      // 変更通知
      onPathsChange(newPaths)
    }
  }

  const stopErasing = () => {
    setIsErasing(false)
    setLastErasePos(null)
  }

  return {
    isErasing,
    startErasing,
    eraseAtPosition,
    stopErasing
  }
}
