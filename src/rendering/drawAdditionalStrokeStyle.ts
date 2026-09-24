import type { DrawingPath } from '../types'

export interface StrokeGeometry {
  scaleX: number
  scaleY: number
  widthScale: number
  offsetX?: number
  offsetY?: number
}

const noise = (value: number) => {
  let hashed = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  hashed = Math.imul(hashed ^ (hashed >>> 16), 0x45d9f3b)
  return ((hashed ^ (hashed >>> 16)) >>> 0) / 0x100000000
}

/** Draws the extra CopiCopi stroke styles at any canvas size, including previews. */
export const drawAdditionalStrokeStyle = (
  context: CanvasRenderingContext2D,
  path: DrawingPath,
  geometry: StrokeGeometry,
  color = path.color,
): boolean => {
  if (path.style !== 'calligraphy' && path.style !== 'crayon') return false
  if (path.points.length === 0) return true

  const { scaleX, scaleY, widthScale, offsetX = 0, offsetY = 0 } = geometry
  const points = path.points.map(point => ({
    x: offsetX + point.x * scaleX,
    y: offsetY + point.y * scaleY,
  }))
  const width = Math.max(0.65, path.width * widthScale)
  context.save()
  context.strokeStyle = color
  context.fillStyle = color
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (path.style === 'calligraphy') {
    // A fixed 45-degree flat nib gives thick and thin strokes according to direction.
    const nibX = width * Math.SQRT1_2 / 2
    const nibY = -nibX
    const thinWidth = Math.max(0.5, width * 0.28)

    context.lineWidth = thinWidth
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    points.slice(1).forEach(point => context.lineTo(point.x, point.y))
    context.stroke()

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]
      const current = points[index]
      context.beginPath()
      context.moveTo(previous.x + nibX, previous.y + nibY)
      context.lineTo(previous.x - nibX, previous.y - nibY)
      context.lineTo(current.x - nibX, current.y - nibY)
      context.lineTo(current.x + nibX, current.y + nibY)
      context.closePath()
      context.fill()
    }
    context.beginPath()
    for (const point of points) {
      context.moveTo(point.x + nibX, point.y + nibY)
      context.ellipse(point.x, point.y, width / 2, thinWidth / 2, -Math.PI / 4, 0, Math.PI * 2)
    }
    context.fill()
  } else {
    // The pale body and deterministic short grains produce a rough, stable texture.
    const inheritedAlpha = context.globalAlpha
    context.globalAlpha = inheritedAlpha * 0.5
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2)
      context.fill()
    } else {
      context.lineWidth = width * 0.9
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index]
        const next = points[index + 1]
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
      }
      const last = points[points.length - 1]
      context.lineTo(last.x, last.y)
      context.stroke()

      context.globalAlpha = inheritedAlpha * 0.8
      context.lineWidth = Math.max(0.4, width * 0.12)
      context.beginPath()
      const pathSeed = Math.round(path.points[0].x * 65535) * 31 + Math.round(path.points[0].y * 65535)
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]
        const current = points[index]
        const dx = current.x - previous.x
        const dy = current.y - previous.y
        const length = Math.hypot(dx, dy)
        if (length < 0.01) continue
        const count = Math.max(1, Math.ceil(length / Math.max(1.5, width * 0.3)))
        const normalX = -dy / length
        const normalY = dx / length
        for (let sample = 0; sample < count; sample += 1) {
          const seed = pathSeed + index * 7919 + sample * 101
          if (noise(seed) < 0.24) continue
          const along = (sample + noise(seed + 1)) / count
          const offset = (noise(seed + 2) - 0.5) * width * 0.8
          const x = previous.x + dx * along + normalX * offset
          const y = previous.y + dy * along + normalY * offset
          const grainLength = Math.min(length / count, Math.max(0.8, width * (0.15 + noise(seed + 3) * 0.15)))
          context.moveTo(x, y)
          context.lineTo(x + dx / length * grainLength, y + dy / length * grainLength)
        }
      }
      context.stroke()
    }
  }

  context.restore()
  return true
}
