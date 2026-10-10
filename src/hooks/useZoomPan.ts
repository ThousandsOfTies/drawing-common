import { useState, useEffect, useCallback, useRef } from 'react'

const FIT_MARGIN = 10
const MAX_FIT_ZOOM = 2
const MAX_ZOOM = 5

interface ZoomPanOptions {
  /** Includes sibling input overlays; the cursor still determines the active pane. */
  wheelEventTargetRef?: React.RefObject<HTMLElement>
}

export const useZoomPan = (
  containerRef: React.RefObject<HTMLDivElement>,
  minFitZoom: number = 0.1,
  onResetToFit?: () => void,
  canvasRef?: React.RefObject<HTMLCanvasElement>,
  options?: ZoomPanOptions
) => {
  // 論理座標はPDF原寸。初期フィット完了までは等倍で扱う。
  const [zoom, setZoom] = useState(1.0)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [overscroll, setOverscroll] = useState({ x: 0, y: 0 })
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  const [lastWheelCursor, setLastWheelCursor] = useState<{ x: number; y: number } | null>(null)
  const viewportRef = useRef({ zoom, panOffset })
  viewportRef.current = { zoom, panOffset }
  const wheelEventTargetRef = options?.wheelEventTargetRef

  // パン（移動）機能 - Ctrl+ドラッグで移動
  const startPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  // パン範囲制限を適用する関数
  // 新仕様: 右移動時はPDFの左端が表示領域の右端まで、左移動時はPDFの右端が表示領域の左端まで
  const applyPanLimit = useCallback((offset: { x: number; y: number }, currentZoom?: number): { x: number; y: number } => {
    if (!containerRef.current || !canvasRef?.current) {
      return offset
    }

    const container = containerRef.current
    const canvas = canvasRef.current

    // PDFの表示サイズ（ズーム適用後）
    const zoomValue = currentZoom ?? viewportRef.current.zoom
    // CSS dimensions are the stable logical size. The backing bitmap may use a
    // different resolution without affecting pan limits.
    const contentWidth = canvas.clientWidth || canvas.width
    const contentHeight = canvas.clientHeight || canvas.height
    const displayWidth = contentWidth * zoomValue
    const displayHeight = contentHeight * zoomValue

    // コンテナのサイズ
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight

    let limitedX = offset.x
    let limitedY = offset.y

    // X方向の制限
    // 基本: 左端(0) ～ 右端(container-display)
    // displayWidthがcontainerWidthより大きい:
    //   minX = containerWidth - displayWidth (右端が見える位置)
    //   maxX = 0 (左端が見える位置)
    // 小さい場合:
    //   minX = 0
    //   maxX = containerWidth - displayWidth
    let minX: number, maxX: number
    if (displayWidth >= containerWidth) {
      minX = containerWidth - displayWidth
      maxX = 0
    } else {
      minX = 0
      maxX = containerWidth - displayWidth
    }

    limitedX = Math.max(minX, Math.min(maxX, offset.x))

    // Y方向の制限
    let minY: number, maxY: number
    if (displayHeight >= containerHeight) {
      minY = containerHeight - displayHeight
      maxY = 0
    } else {
      minY = 0
      maxY = containerHeight - displayHeight
    }

    limitedY = Math.max(minY, Math.min(maxY, offset.y))

    return { x: limitedX, y: limitedY }
  }, [containerRef, canvasRef])


  const doPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return

    const newOffset = {
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    }

    // パン制限を適用（PDFが画面外に消えないように）
    const limitedOffset = applyPanLimit(newOffset)

    // オーバースクロール計算（制限された分だけずらす）
    // 抵抗感を出すために係数を掛ける
    const OVERSCROLL_RESISTANCE = 0.4
    const diffX = (newOffset.x - limitedOffset.x) * OVERSCROLL_RESISTANCE
    const diffY = (newOffset.y - limitedOffset.y) * OVERSCROLL_RESISTANCE

    setOverscroll({ x: diffX, y: diffY })
    setPanOffset(limitedOffset)
  }

  const stopPanning = () => {
    setIsPanning(false)
    // overscrollのリセットと判定は呼び出し元で行う
  }

  // オーバースクロールをリセットする関数
  const resetOverscroll = useCallback(() => {
    setOverscroll({ x: 0, y: 0 })
  }, [])

  // ズーム機能
  // options: { fitToHeight?: boolean, alignLeft?: boolean }
  const fitToScreen = useCallback((
    contentWidth: number,
    contentHeight: number,
    overrideContainerHeight?: number,
    options?: { fitToHeight?: boolean; alignLeft?: boolean }
  ) => {
    // Force HMR and verify argument
    // if (overrideContainerHeight) {
    //   console.log('📏 fitToScreen: Using Override Height:', overrideContainerHeight)
    // }

    if (!containerRef.current) return

    const containerW = containerRef.current.clientWidth
    const containerH = overrideContainerHeight ?? containerRef.current.clientHeight

    // マージン考慮（上下左右 10px）
    const availableW = containerW - (FIT_MARGIN * 2)
    const availableH = containerH - (FIT_MARGIN * 2)

    // 最適なズームレベルを計算（画面に収まる最大サイズ）
    // 0除算防止
    if (contentWidth === 0 || contentHeight === 0 || availableW <= 0 || availableH <= 0) {
      return
    }

    const scaleX = availableW / contentWidth
    const scaleY = availableH / contentHeight

    // fitToHeightオプション: 高さにのみフィット（横長PDFがより大きく表示される）
    let newZoom: number
    if (options?.fitToHeight) {
      newZoom = scaleY
    } else {
      newZoom = Math.min(scaleX, scaleY)
    }

    // 最小・最大ズーム範囲の制限
    const clampedZoom = Math.max(minFitZoom, Math.min(MAX_FIT_ZOOM, newZoom))

    // センタリング or 左寄せ
    const displayW = contentWidth * clampedZoom
    const displayH = contentHeight * clampedZoom

    // alignLeftオプション: 左寄せ（スプリット表示時に便利）
    const offsetX = options?.alignLeft ? FIT_MARGIN : (containerW - displayW) / 2
    const offsetY = (containerH - displayH) / 2

    // 念のため制限を適用（計算値が正しいはずだが保険として）
    const limitedOffset = applyPanLimit({ x: offsetX, y: offsetY }, clampedZoom)

    viewportRef.current = { zoom: clampedZoom, panOffset: limitedOffset }
    setOverscroll({ x: 0, y: 0 }) // オーバースクロールがあればリセット
    setZoom(clampedZoom)
    setPanOffset(limitedOffset)
  }, [containerRef, minFitZoom, applyPanLimit])

  const resetZoom = () => {
    if (onResetToFit) {
      onResetToFit()
    } else {
      setZoom(1.0)
      setPanOffset({ x: 0, y: 0 })
    }
  }

  // 現在のコンテナとコンテンツサイズに基づいて、画面に収まる最小倍率を計算
  const getFitToScreenZoom = useCallback(() => {
    if (!containerRef.current || !canvasRef?.current) return minFitZoom

    const container = containerRef.current
    const canvas = canvasRef.current

    // 0除算防止
    const contentWidth = canvas.clientWidth || canvas.width
    const contentHeight = canvas.clientHeight || canvas.height
    if (contentWidth === 0 || contentHeight === 0) return minFitZoom

    // Use logical paper dimensions so display resolution cannot move the zoom limit.
    const scaleX = (container.clientWidth - FIT_MARGIN * 2) / contentWidth
    const scaleY = (container.clientHeight - FIT_MARGIN * 2) / contentHeight

    return Math.max(minFitZoom, Math.min(MAX_FIT_ZOOM, scaleX, scaleY))
  }, [containerRef, canvasRef, minFitZoom])

  const getMinimumZoom = useCallback(() => {
    // After a resize, zoom-out must not enlarge a page that was already below
    // the new fit size. Further shrinking stops at its current size instead.
    return Math.min(viewportRef.current.zoom, getFitToScreenZoom())
  }, [getFitToScreenZoom])

  const clampZoom = useCallback((value: number) => {
    if (!Number.isFinite(value)) return viewportRef.current.zoom
    return Math.min(MAX_ZOOM, Math.max(getMinimumZoom(), value))
  }, [getMinimumZoom])

  // Ctrl+ホイールでズーム（マウスカーソルを中心に）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || (!e.ctrlKey && !e.metaKey) || !Number.isFinite(e.deltaY) || e.deltaY === 0) return
      const container = containerRef.current
      if (!container) return
      const surface = wheelEventTargetRef?.current ?? container
      const target = e.target as Node
      if (!surface.contains(target)) return
      const containerRect = container.getBoundingClientRect()
      if (e.clientX < containerRect.left || e.clientX >= containerRect.right
        || e.clientY < containerRect.top || e.clientY >= containerRect.bottom) return

      e.preventDefault()
      e.stopPropagation()

      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const { zoom: oldZoom, panOffset: oldPanOffset } = viewportRef.current

      const newZoom = clampZoom(oldZoom + delta)
      const cursorX = e.clientX - containerRect.left
      const cursorY = e.clientY - containerRect.top
      setLastWheelCursor({ x: e.clientX, y: e.clientY })

      const scaleRatio = newZoom / oldZoom
      const newPanOffsetX = cursorX - (cursorX - oldPanOffset.x) * scaleRatio
      const newPanOffsetY = cursorY - (cursorY - oldPanOffset.y) * scaleRatio

      // パン制限を適用（PDFが画面外に消えないように）
      const limitedOffset = applyPanLimit({ x: newPanOffsetX, y: newPanOffsetY }, newZoom)

      // Native wheel events can arrive before React commits the previous one.
      viewportRef.current = { zoom: newZoom, panOffset: limitedOffset }
      setOverscroll({ x: 0, y: 0 })
      setZoom(newZoom)
      setPanOffset(limitedOffset)
    }

    // Page-turn listeners run first so Ctrl-wheel can cancel an unfinished turn.
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      document.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, wheelEventTargetRef, applyPanLimit, clampZoom])

  // Ctrlキーの状態を追跡
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setIsCtrlPressed(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        setIsCtrlPressed(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return {
    zoom,
    setZoom,
    isPanning,
    panOffset,
    setPanOffset,
    overscroll,       // 追加
    setOverscroll,    // 追加
    resetOverscroll,  // 追加
    isCtrlPressed,
    startPanning,
    doPanning,
    stopPanning,
    resetZoom,
    lastWheelCursor,
    applyPanLimit,
    fitToScreen,
    getFitToScreenZoom,
    getMinimumZoom,
    clampZoom,
  }
}
