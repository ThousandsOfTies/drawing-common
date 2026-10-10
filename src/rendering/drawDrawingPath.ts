import type { DrawingPath } from '../types'
import { drawAdditionalStrokeStyle, type StrokeGeometry } from './drawAdditionalStrokeStyle'
import { drawStationaryStroke } from './drawStationaryStroke'

interface PaintOptions {
  color?: string
  opacity?: number
  layer?: { current: HTMLCanvasElement | null }
}

/** The same curve, nib and alpha compositing for paper bitmaps and visible viewports. */
export function drawDrawingPath(
  context: CanvasRenderingContext2D,
  path: DrawingPath,
  geometry: StrokeGeometry,
  options: PaintOptions = {},
): void {
  if (!path.points.length || path.kind === 'fill') return
  const { scaleX, scaleY, widthScale, offsetX = 0, offsetY = 0 } = geometry
  const opacity = options.opacity ?? path.opacity ?? 1
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maximumWidth = path.width
  for (const point of path.points) {
    const x = point.x * scaleX + offsetX, y = point.y * scaleY + offsetY
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    maximumWidth = Math.max(maximumWidth, point.width ?? path.width)
  }
  const padding = maximumWidth * widthScale / 2 + 2
  const left = Math.max(0, Math.floor(minX - padding))
  const top = Math.max(0, Math.floor(minY - padding))
  const right = Math.min(context.canvas.width, Math.ceil(maxX + padding))
  const bottom = Math.min(context.canvas.height, Math.ceil(maxY + padding))
  if (right <= left || bottom <= top || opacity <= 0) return

  // A translucent brush may overlap itself. Paint it opaque once, then composite
  // only its visible rectangle, rather than allocating a zoomed page-sized canvas.
  const layer = opacity < 1
    ? options.layer?.current ?? document.createElement('canvas')
    : null
  if (layer && options.layer) options.layer.current = layer
  if (layer) {
    if (layer.width !== right - left || layer.height !== bottom - top) {
      layer.width = right - left
      layer.height = bottom - top
    } else {
      layer.getContext('2d')?.clearRect(0, 0, layer.width, layer.height)
    }
  }
  const ctx = layer?.getContext('2d') ?? context
  ctx.save()
  ctx.translate(offsetX - (layer ? left : 0), offsetY - (layer ? top : 0))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = options.color ?? path.color
  ctx.fillStyle = ctx.strokeStyle
  ctx.globalAlpha = 1
  ctx.lineWidth = path.width * widthScale
  const localGeometry = { scaleX, scaleY, widthScale }
  const pts = path.points
  if (drawAdditionalStrokeStyle(ctx, path, localGeometry, ctx.strokeStyle)) {
    // Extra nibs use the same projection as ordinary pen and brush strokes.
  } else if (drawStationaryStroke(ctx, pts, path.style === 'brush' ? pts[0].width ?? path.width : path.width, localGeometry)) {
    // A tap has area even when all recorded samples have identical coordinates.
  } else if (path.style === 'brush') {
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath()
      ctx.lineWidth = ((pts[i - 1].width ?? path.width) + (pts[i].width ?? path.width)) * widthScale / 2
      ctx.moveTo(pts[i - 1].x * scaleX, pts[i - 1].y * scaleY)
      ctx.lineTo(pts[i].x * scaleX, pts[i].y * scaleY)
      ctx.stroke()
    }
  } else {
    ctx.beginPath()
    ctx.moveTo(pts[0].x * scaleX, pts[0].y * scaleY)
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x * scaleX, pts[i].y * scaleY,
        (pts[i].x + pts[i + 1].x) * scaleX / 2, (pts[i].y + pts[i + 1].y) * scaleY / 2)
    }
    ctx.lineTo(pts[pts.length - 1].x * scaleX, pts[pts.length - 1].y * scaleY)
    ctx.stroke()
  }
  ctx.restore()
  if (layer) {
    context.save()
    context.globalAlpha = opacity
    context.drawImage(layer, left, top)
    context.restore()
  }
}
