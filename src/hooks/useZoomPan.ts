import { useState, useEffect, useCallback, useRef } from 'react'
import { zoomAtPoint, touchPair, type PinchGesture, type Point, type Viewport } from '../geometry/viewport'

const FIT_MARGIN = 10
const MAX_FIT_ZOOM = 2
const MAX_ZOOM = 5
type PaperSize = { width: number; height: number }
type ZoomValue = number | ((previous: number) => number)
type PanValue = Point | ((zoom: number, previous: Viewport) => Point)

interface ZoomPanOptions {
  /** Includes sibling input overlays; the cursor still determines the active pane. */
  wheelEventTargetRef?: React.RefObject<HTMLElement>
  minimumZoom?: number
  constrainPan?: boolean
  nativeWheel?: boolean
}

export const useZoomPan = (
  containerRef: React.RefObject<HTMLDivElement>,
  minFitZoom: number = 0.1,
  onResetToFit?: () => void,
  canvasRef?: React.RefObject<HTMLCanvasElement>,
  options?: ZoomPanOptions
) => {
  const [viewport, setViewportState] = useState<Viewport>({ zoom: 1, panOffset: { x: 0, y: 0 } })
  const { zoom, panOffset } = viewport
  const viewportRef = useRef(viewport)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<Point | null>(null)
  const [overscroll, setOverscroll] = useState({ x: 0, y: 0 })
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  const [lastWheelCursor, setLastWheelCursor] = useState<Point | null>(null)
  const wheelEventTargetRef = options?.wheelEventTargetRef
  const minimumZoom = options?.minimumZoom
  const constrainPan = options?.constrainPan !== false
  const nativeWheel = options?.nativeWheel !== false

  const getPaperSize = useCallback((): PaperSize | undefined => {
    const canvas = canvasRef?.current
    if (!canvas) return undefined
    // The bitmap resolution must not change logical zoom or pan limits.
    return { width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height }
  }, [canvasRef])

  const applyPanLimit = useCallback((offset: Point, currentZoom?: number, paperSize?: PaperSize): Point => {
    if (!constrainPan) return offset
    const container = containerRef.current
    const paper = paperSize ?? getPaperSize()
    if (!container || !paper) return offset
    const scale = currentZoom ?? viewportRef.current.zoom
    const remainingWidth = container.clientWidth - paper.width * scale
    const remainingHeight = container.clientHeight - paper.height * scale
    return {
      x: Math.max(Math.min(0, remainingWidth), Math.min(Math.max(0, remainingWidth), offset.x)),
      y: Math.max(Math.min(0, remainingHeight), Math.min(Math.max(0, remainingHeight), offset.y)),
    }
  }, [containerRef, getPaperSize, constrainPan])

  const getFitToScreenZoom = useCallback((paperSize?: PaperSize) => {
    const container = containerRef.current
    const paper = paperSize ?? getPaperSize()
    if (!container || !paper || !(paper.width > 0) || !(paper.height > 0)) return minFitZoom
    return Math.max(minFitZoom, Math.min(MAX_FIT_ZOOM,
      (container.clientWidth - FIT_MARGIN * 2) / paper.width,
      (container.clientHeight - FIT_MARGIN * 2) / paper.height))
  }, [containerRef, getPaperSize, minFitZoom])

  const getMinimumZoom = useCallback(() => {
    // Resizing must not turn a zoom-out operation into an enlargement.
    return minimumZoom ?? Math.min(viewportRef.current.zoom, getFitToScreenZoom())
  }, [getFitToScreenZoom, minimumZoom])

  // This is the only viewport writer. Every command, including fitting and page
  // restoration, resolves its limits here before projecting the pan position.
  const updateViewport = useCallback((zoomValue: ZoomValue, panValue?: PanValue,
    updateOptions?: { paperSize?: PaperSize; fit?: boolean; overscrollResistance?: number; keepOverscroll?: boolean }) => {
    const previous = viewportRef.current
    const requestedZoom = typeof zoomValue === 'function' ? zoomValue(previous.zoom) : zoomValue
    if (!Number.isFinite(requestedZoom)) return previous
    const minimum = updateOptions?.fit ? minFitZoom
      : minimumZoom ?? Math.min(previous.zoom, getFitToScreenZoom(updateOptions?.paperSize))
    const maximum = updateOptions?.fit ? MAX_FIT_ZOOM : MAX_ZOOM
    const nextZoom = Math.min(maximum, Math.max(minimum, requestedZoom))
    const requestedPan = typeof panValue === 'function' ? panValue(nextZoom, previous)
      : panValue ?? previous.panOffset
    if (!Number.isFinite(requestedPan.x) || !Number.isFinite(requestedPan.y)) return previous
    const nextPan = applyPanLimit(requestedPan, nextZoom, updateOptions?.paperSize)
    const next = { zoom: nextZoom, panOffset: nextPan }
    // Native events may arrive again before React renders the previous update.
    viewportRef.current = next
    setViewportState(next)
    if (!updateOptions?.keepOverscroll) {
      setOverscroll({ x: 0, y: (requestedPan.y - nextPan.y) * (updateOptions?.overscrollResistance ?? 0) })
    }
    return next
  }, [applyPanLimit, getFitToScreenZoom, minFitZoom, minimumZoom])

  // Public setters are commands, never raw React state setters.
  const setZoom = useCallback((value: ZoomValue) => updateViewport(value), [updateViewport])
  const setPanOffset = useCallback((value: Point | ((previous: Point) => Point)) =>
    updateViewport(previous => previous, (_zoom, previous) =>
      typeof value === 'function' ? value(previous.panOffset) : value, { keepOverscroll: true }), [updateViewport])
  const getViewport = useCallback(() => ({
    zoom: viewportRef.current.zoom, panOffset: { ...viewportRef.current.panOffset },
  }), [])
  const restoreViewport = useCallback((value: Viewport, paperSize?: PaperSize) =>
    updateViewport(value.zoom, value.panOffset, { paperSize }), [updateViewport])

  const zoomAt = useCallback((value: ZoomValue, anchor: Point) =>
    updateViewport(value, (resolvedZoom, previous) => zoomAtPoint(previous, anchor, resolvedZoom).panOffset),
  [updateViewport])

  const applyPinch = useCallback((gesture: PinchGesture, pair: ReturnType<typeof touchPair>) => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds || !(gesture.startDist > 0) || !(gesture.startZoom > 0) || !Number.isFinite(pair.distance)) return
    return updateViewport(gesture.startZoom * pair.distance / gesture.startDist, resolvedZoom => {
      const view = zoomAtPoint({ zoom: gesture.startZoom, panOffset: gesture.startPan },
        { x: gesture.startCenter.x - bounds.left, y: gesture.startCenter.y - bounds.top }, resolvedZoom)
      return {
        x: view.panOffset.x + pair.center.x - gesture.startCenter.x,
        y: view.panOffset.y + pair.center.y - gesture.startCenter.y,
      }
    }, { overscrollResistance: 0.6 })
  }, [containerRef, updateViewport])

  const resetOverscroll = useCallback(() => setOverscroll({ x: 0, y: 0 }), [])

  const fitToScreen = useCallback((overrideContainerHeight?: number,
    fitOptions?: { fitToHeight?: boolean; alignLeft?: boolean }) => {
    const container = containerRef.current
    // Fitting owns its geometry too: no caller can substitute backing pixels
    // for the logical paper dimensions (including a hidden 1x1 PDF bitmap).
    const paper = getPaperSize()
    if (!container || !paper) return
    const { width: contentWidth, height: contentHeight } = paper
    const containerW = container.clientWidth
    const containerH = overrideContainerHeight ?? container.clientHeight
    const availableW = containerW - FIT_MARGIN * 2
    const availableH = containerH - FIT_MARGIN * 2
    if (!(contentWidth > 0) || !(contentHeight > 0) || availableW <= 0 || availableH <= 0) return
    const requestedZoom = fitOptions?.fitToHeight ? availableH / contentHeight
      : Math.min(availableW / contentWidth, availableH / contentHeight)
    return updateViewport(requestedZoom, resolvedZoom => ({
      x: fitOptions?.alignLeft ? FIT_MARGIN : (containerW - contentWidth * resolvedZoom) / 2,
      y: (containerH - contentHeight * resolvedZoom) / 2,
    }), { paperSize: paper, fit: true })
  }, [containerRef, getPaperSize, updateViewport])

  const resetZoom = () => {
    if (onResetToFit) onResetToFit()
    else updateViewport(1, { x: 0, y: 0 })
  }

  const startPanningAt = (clientX: number, clientY: number) => {
    setIsPanning(true)
    const currentPan = viewportRef.current.panOffset
    panStartRef.current = { x: clientX - currentPan.x, y: clientY - currentPan.y }
  }
  const panTo = (clientX: number, clientY: number) => {
    const start = panStartRef.current
    if (!start) return
    const offset = { x: clientX - start.x, y: clientY - start.y }
    const next = setPanOffset(offset)
    setOverscroll({ x: (offset.x - next.panOffset.x) * 0.4, y: (offset.y - next.panOffset.y) * 0.4 })
  }
  const stopPanning = () => { panStartRef.current = null; setIsPanning(false) }
  const startPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    startPanningAt(e.clientX, e.clientY)
  }
  const doPanning = (e: React.MouseEvent<HTMLDivElement>) => panTo(e.clientX, e.clientY)

  useEffect(() => {
    if (!nativeWheel) return
    const handleWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || (!e.ctrlKey && !e.metaKey) || !Number.isFinite(e.deltaY) || e.deltaY === 0) return
      const container = containerRef.current
      if (!container) return
      const surface = wheelEventTargetRef?.current ?? container
      if (!surface.contains(e.target as Node)) return
      const bounds = container.getBoundingClientRect()
      if (e.clientX < bounds.left || e.clientX >= bounds.right
        || e.clientY < bounds.top || e.clientY >= bounds.bottom) return
      e.preventDefault()
      e.stopPropagation()
      setLastWheelCursor({ x: e.clientX, y: e.clientY })
      zoomAt(previous => previous + (e.deltaY > 0 ? -0.1 : 0.1),
        { x: e.clientX - bounds.left, y: e.clientY - bounds.top })
    }
    // Page-turn listeners run first so Ctrl-wheel can cancel an unfinished turn.
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [containerRef, wheelEventTargetRef, zoomAt, nativeWheel])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) setIsCtrlPressed(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) setIsCtrlPressed(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return {
    zoom, setZoom, isPanning, panOffset, setPanOffset, overscroll, setOverscroll,
    resetOverscroll, isCtrlPressed, startPanning, doPanning, stopPanning, resetZoom,
    lastWheelCursor, applyPanLimit, fitToScreen, getFitToScreenZoom, getMinimumZoom,
    getViewport, restoreViewport, zoomAt, applyPinch, startPanningAt, panTo,
  }
}
