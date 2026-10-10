export interface CanvasSize {
  width: number
  height: number
}

const logicalSizes = new WeakMap<HTMLCanvasElement, CanvasSize>()
const MAX_DISPLAY_PIXELS = 7_000_000

/** Paper, saved strokes and text use logical coordinates regardless of screen density. */
export function getCanvasLogicalSize(canvas: HTMLCanvasElement): CanvasSize {
  return logicalSizes.get(canvas) ?? { width: canvas.width, height: canvas.height }
}

/** Allocate sharper display pixels without enlarging the paper or its drawing coordinates. */
export function resizeCanvasForDisplay(canvas: HTMLCanvasElement, width: number, height: number): void {
  const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const scale = Math.min(Math.max(1, density), 2, Math.sqrt(MAX_DISPLAY_PIXELS / (width * height)))
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  logicalSizes.set(canvas, { width, height })
  canvas.getContext('2d')?.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
}
