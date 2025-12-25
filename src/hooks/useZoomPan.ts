import { useState, useEffect, useCallback } from 'react'

export const useZoomPan = (
  containerRef: React.RefObject<HTMLDivElement>,
  renderScale: number = 5.0,
  minFitZoom: number = 1.0 / 5.0,
  onResetToFit?: () => void,
  canvasRef?: React.RefObject<HTMLCanvasElement>
) => {
  // プリレンダリング戦略: 初期zoom = 1/RENDER_SCALE（等倍表示）
  const [zoom, setZoom] = useState(1.0 / renderScale)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  const [lastWheelCursor, setLastWheelCursor] = useState<{ x: number; y: number } | null>(null)

  // パン（移動）機能 - Ctrl+ドラッグで移動
  const startPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  // パン範囲制限を適用する関数（常に2/3が表示されるように）
  const applyPanLimit = (offset: { x: number; y: number }, currentZoom?: number): { x: number; y: number } => {
    if (!containerRef.current || !canvasRef?.current) {
      return offset
    }

    const container = containerRef.current
    const canvas = canvasRef.current

    // PDFの表示サイズ（ズーム適用後）
    const zoomValue = currentZoom ?? zoom
    const displayWidth = canvas.width * zoomValue
    const displayHeight = canvas.height * zoomValue

    // コンテナのサイズ
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight

    // 表示されているPDFの部分が常に2/3以上になるように制限
    // PDFが画面より大きい場合のみ制限を適用
    let limitedX = offset.x
    let limitedY = offset.y

    if (displayWidth > containerWidth) {
      // X方向の制限: PDFの左端1/3まで隠れる、右端1/3まで隠れる
      const minX = -displayWidth / 3  // PDFが左にパンした時の最小値
      const maxX = containerWidth - displayWidth * (2 / 3)  // PDFが右にパンした時の最大値
      const originalX = limitedX
      limitedX = Math.max(minX, Math.min(maxX, offset.x))

      // デバッグログ（制限が適用された場合のみ）
      if (originalX !== limitedX) {
        console.log('🔒 X方向パン制限適用:', {
          displayWidth,
          containerWidth,
          minX,
          maxX,
          requestedX: offset.x,
          limitedX
        })
      }
    }

    if (displayHeight > containerHeight) {
      // Y方向の制限: PDFの上端1/3まで隠れる、下端1/3まで隠れる
      const minY = -displayHeight / 3  // PDFが上にパンした時の最小値
      const maxY = containerHeight - displayHeight * (2 / 3)  // PDFが下にパンした時の最大値
      const originalY = limitedY
      limitedY = Math.max(minY, Math.min(maxY, offset.y))

      // デバッグログ（制限が適用された場合のみ）
      if (originalY !== limitedY) {
        console.log('🔒 Y方向パン制限適用:', {
          displayHeight,
          containerHeight,
          minY,
          maxY,
          requestedY: offset.y,
          limitedY
        })
      }
    }

    return { x: limitedX, y: limitedY }
  }

  const doPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return

    const newOffset = {
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    }

    setPanOffset(newOffset)
  }

  const stopPanning = () => {
    setIsPanning(false)
  }

  // ズーム機能
  // options: { fitToHeight?: boolean, alignLeft?: boolean }
  const fitToScreen = useCallback((
    contentWidth: number,
    contentHeight: number,
    overrideContainerHeight?: number,
    options?: { fitToHeight?: boolean; alignLeft?: boolean }
  ) => {
    // Force HMR and verify argument
    if (overrideContainerHeight) {
      console.log('📏 fitToScreen: Using Override Height:', overrideContainerHeight)
    }

    if (!containerRef.current) return

    const containerW = containerRef.current.clientWidth
    const containerH = overrideContainerHeight ?? containerRef.current.clientHeight

    // マージン考慮（上下左右 10px）
    const MARGIN = 10
    const availableW = containerW - (MARGIN * 2)
    const availableH = containerH - (MARGIN * 2)

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
    const clampedZoom = Math.max(minFitZoom, Math.min(2.0, newZoom))

    // センタリング or 左寄せ
    const displayW = contentWidth * clampedZoom
    const displayH = contentHeight * clampedZoom

    // alignLeftオプション: 左寄せ（スプリット表示時に便利）
    const offsetX = options?.alignLeft ? MARGIN : (containerW - displayW) / 2
    const offsetY = (containerH - displayH) / 2

    // 詳細ログ出力（ユーザーデバッグ用）
    const computedStyle = window.getComputedStyle(containerRef.current)
    console.group('📏 fitToScreen 詳細計算')
    console.log('📦 Container:', { width: containerW, height: containerH })
    console.log('📄 Content:', { width: contentWidth, height: contentHeight })
    console.log('🔍 Zoom:', { scaleX, scaleY, newZoom, clampedZoom, fitToHeight: options?.fitToHeight })
    console.log('📍 Position:', { offsetX, offsetY, alignLeft: options?.alignLeft })
    console.groupEnd()

    setZoom(clampedZoom)
    setPanOffset({ x: offsetX, y: offsetY })
  }, [containerRef, minFitZoom])

  const resetZoom = () => {
    // プリレンダリング: リセットは等倍表示（1/RENDER_SCALE）に戻す
    // もしcanvasRefがあればfitToScreenを呼ぶ方が良いが、引数が必要なので
    // ここでは単純リセットか、onResetToFitコールバックに任せる
    if (onResetToFit) {
      onResetToFit()
    } else {
      setZoom(1.0 / renderScale)
      setPanOffset({ x: 0, y: 0 })
    }
  }

  // Ctrl+ホイールでズーム（マウスカーソルを中心に）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // containerRef内でのホイールイベントのみ処理
      if (!containerRef.current) return

      const target = e.target as Node
      if (!containerRef.current.contains(target)) return

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const delta = e.deltaY > 0 ? -0.1 : 0.1
        const oldZoom = zoom
        // プリレンダリング: zoom範囲 minFitZoom ～ 2.0 (1000%)
        let newZoom = Math.max(minFitZoom, Math.min(2.0, oldZoom + delta))

        // マウスカーソルを中心にズームするため、パンオフセットを調整
        const containerRect = containerRef.current.getBoundingClientRect()

        // マウスカーソルのコンテナ内での位置（ビューポート座標 - コンテナのビューポート座標）
        const cursorX = e.clientX - containerRect.left
        const cursorY = e.clientY - containerRect.top

        // 最後のホイールイベントのマウス位置を保存（ビューポート座標で保存）
        setLastWheelCursor({ x: e.clientX, y: e.clientY })

        // 現在のpanOffsetを考慮した、カーソルが指しているコンテンツ座標
        // contentX = (cursorX - panOffset.x) / oldZoom
        // ズーム後も同じコンテンツ座標がcursorXに来るように調整
        // cursorX = contentX * newZoom + newPanOffset
        // newPanOffset = cursorX - contentX * newZoom
        //              = cursorX - (cursorX - oldPanOffset) * (newZoom / oldZoom)
        const scaleRatio = newZoom / oldZoom
        const newPanOffsetX = cursorX - (cursorX - panOffset.x) * scaleRatio
        const newPanOffsetY = cursorY - (cursorY - panOffset.y) * scaleRatio

        setZoom(newZoom)
        setPanOffset({
          x: newPanOffsetX,
          y: newPanOffsetY
        })
      }
    }

    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      document.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, zoom, panOffset, minFitZoom, onResetToFit])

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
    isCtrlPressed,
    startPanning,
    doPanning,
    stopPanning,
    resetZoom,
    lastWheelCursor,
    applyPanLimit,
    fitToScreen
  }
}
