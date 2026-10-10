export type Point = { x: number; y: number }

export function viewportCursorPosition(
  container: Pick<HTMLElement, 'getBoundingClientRect' | 'clientLeft' | 'clientTop' | 'scrollLeft' | 'scrollTop'> | null,
  clientX: number, clientY: number, diameter: number,
) {
  if (!container) return null
  const bounds = container.getBoundingClientRect()
  return {
    x: clientX - bounds.left - container.clientLeft + container.scrollLeft,
    y: clientY - bounds.top - container.clientTop + container.scrollTop,
    diameter,
  }
}
export type Viewport = { zoom: number; panOffset: Point }
export type PinchGesture = { startZoom: number; startPan: Point; startDist: number; startCenter: Point }

export function zoomAtPoint(view: Viewport, anchor: Point, zoom: number): Viewport {
  return { zoom, panOffset: {
    x: anchor.x - (anchor.x - view.panOffset.x) / view.zoom * zoom,
    y: anchor.y - (anchor.y - view.panOffset.y) / view.zoom * zoom,
  } }
}

export function touchPair(touches: ArrayLike<{ clientX: number; clientY: number }>) {
  const first = touches[0], second = touches[1]
  return {
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
    center: { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 },
  }
}

export function pinchViewport(gesture: PinchGesture, pair: ReturnType<typeof touchPair>,
  bounds: { left: number; top: number }, minZoom: number, maxZoom = 5): Viewport | null {
  if (!(gesture.startDist > 0) || !(gesture.startZoom > 0) || !Number.isFinite(pair.distance)) return null
  const zoom = Math.min(Math.max(gesture.startZoom * pair.distance / gesture.startDist, minZoom), maxZoom)
  const result = zoomAtPoint({ zoom: gesture.startZoom, panOffset: gesture.startPan },
    { x: gesture.startCenter.x - bounds.left, y: gesture.startCenter.y - bounds.top }, zoom)
  result.panOffset.x += pair.center.x - gesture.startCenter.x
  result.panOffset.y += pair.center.y - gesture.startCenter.y
  return result
}
