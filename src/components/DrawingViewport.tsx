import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DrawingPath, SelectionState } from '../types'
import { resizeCanvasForDisplay } from '../rendering/canvasResolution'
import { drawDrawingPath } from '../rendering/drawDrawingPath'

interface DrawingViewportProps {
  paper: { width: number; height: number }
  zoom: number
  offset: { x: number; y: number }
  paths: DrawingPath[]
  previewPath: DrawingPath | null
  selectionState?: SelectionState | null
  navigating: boolean
  getRasterCanvas: () => HTMLCanvasElement | null
  rasterSize?: { width: number; height: number } | null
  style?: React.CSSProperties
}

/** Display pixels belong to the viewport, so a zoomed page never enlarges an ink bitmap. */
export function DrawingViewport({ paper, zoom, offset, paths, previewPath,
  selectionState, navigating, getRasterCanvas, rasterSize, style }: DrawingViewportProps) {
  const savedRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const savedLayer = useRef<HTMLCanvasElement | null>(null)
  const previewLayer = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const container = savedRef.current?.parentElement
    if (!container) return
    const measure = () => setSize(current => {
      const width = container.clientWidth, height = container.clientHeight
      return width === current.width && height === current.height ? current : { width, height }
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    for (const ref of [savedRef, previewRef]) {
      if (ref.current) resizeCanvasForDisplay(ref.current, size.width, size.height)
    }
  }, [size.width, size.height])

  const prepare = (canvas: HTMLCanvasElement | null) => {
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !size.width || !size.height) return null
    // Paint in physical display pixels. CSS does not scale either display canvas.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const pixelX = canvas.width / size.width, pixelY = canvas.height / size.height
    const geometry = { scaleX: paper.width * zoom * pixelX, scaleY: paper.height * zoom * pixelY,
      widthScale: zoom * Math.min(pixelX, pixelY), offsetX: offset.x * pixelX, offsetY: offset.y * pixelY }
    ctx.save()
    ctx.beginPath()
    ctx.rect(geometry.offsetX, geometry.offsetY, geometry.scaleX, geometry.scaleY)
    ctx.clip()
    return { ctx, geometry, pixelX, pixelY }
  }

  useEffect(() => {
    const paint = prepare(savedRef.current)
    if (!paint) return
    const { ctx, geometry, pixelX } = paint
    const raster = getRasterCanvas()
    // Navigation uses the already rendered paper for smooth gestures. Fills need
    // the full paper's flood-fill topology; its bitmap remains the authoritative mask.
    if (raster && (navigating || paths.some(path => path.kind === 'fill'))) {
      ctx.drawImage(raster, geometry.offsetX, geometry.offsetY, geometry.scaleX, geometry.scaleY)
    } else {
      const lassoIndex = selectionState?.lassoStrokeIndex ?? -1
      paths.forEach((path, index) => {
        if (index === lassoIndex) return
        const selected = selectionState?.selectedIndices.includes(index)
        drawDrawingPath(ctx, path, geometry, { color: selected ? '#3498db' : path.color,
          opacity: selected ? 1 : path.opacity ?? 1, layer: savedLayer })
      })
      const lasso = paths[lassoIndex]
      if (lasso?.points.length) {
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.7)'
        ctx.lineWidth = lasso.width * geometry.widthScale
        ctx.setLineDash([6 * pixelX, 4 * pixelX])
        ctx.beginPath()
        lasso.points.forEach((point, index) => ctx[index ? 'lineTo' : 'moveTo'](
          point.x * geometry.scaleX + geometry.offsetX, point.y * geometry.scaleY + geometry.offsetY))
        ctx.closePath(); ctx.stroke(); ctx.setLineDash([])
      }
    }
    ctx.restore()
  }, [paths, paper.width, paper.height, zoom, offset.x, offset.y, selectionState,
    navigating, getRasterCanvas, rasterSize?.width, rasterSize?.height, size.width, size.height])

  useEffect(() => {
    const paint = prepare(previewRef.current)
    if (!paint) return
    if (previewPath) drawDrawingPath(paint.ctx, previewPath, paint.geometry, { layer: previewLayer })
    paint.ctx.restore()
  }, [previewPath, paper.width, paper.height, zoom, offset.x, offset.y, size.width, size.height])

  const canvasStyle: React.CSSProperties = { position: 'absolute', top: 0, left: 0,
    pointerEvents: 'none', zIndex: 10, ...style }
  return <>
    <canvas ref={savedRef} className="drawing-viewport" aria-hidden="true" style={canvasStyle} />
    <canvas ref={previewRef} className="drawing-viewport-preview" aria-hidden="true" style={canvasStyle} />
  </>
}
