import type { StrokeGeometry } from './drawAdditionalStrokeStyle'

/** A zero-length Canvas line has no area: render taps explicitly, including eraser taps. */
export function drawStationaryStroke(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  geometry: StrokeGeometry = { scaleX: 1, scaleY: 1, widthScale: 1 },
): boolean {
  const first = points[0]
  if (!first || points.some(point => point.x !== first.x || point.y !== first.y)) return false
  const { scaleX, scaleY, widthScale, offsetX = 0, offsetY = 0 } = geometry
  context.save()
  context.fillStyle = context.strokeStyle
  context.beginPath()
  context.arc(offsetX + first.x * scaleX, offsetY + first.y * scaleY, width * widthScale / 2, 0, Math.PI * 2)
  context.fill()
  context.restore()
  return true
}
