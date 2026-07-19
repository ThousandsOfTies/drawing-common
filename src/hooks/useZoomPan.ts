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
  const [overscroll, setOverscroll] = useState({ x: 0, y: 0 })
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  const [lastWheelCursor, setLastWheelCursor] = useState<{ x: number; y: number } | null>(null)

  // パン（移動）機能 - Ctrl+ドラッグで移動
  const startPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  // パン範囲制限を適用する関数
  // 新仕様: 右移動時はPDFの左端が表示領域の右端まで、左移動時はPDFの右端が表示領域の左端まで
  const applyPanLimit = (offset: { x: number; y: number }, currentZoom?: number): { x: number; y: number } => {
    if (!containerRef.current || !canvasRef?.current) {
      return offset
    }

    const container = containerRef.current
    const canvas = canvasRef.current

    // PDFの表示サイズ（ズーム適用後）
    const zoomValue = currentZoom ?? zoom
    // Adaptive rendering can use a smaller backing bitmap while preserving the
    // legacy logical layout size through CSS dimensions.
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
  }


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

    // 念のため制限を適用（計算値が正しいはずだが保険として）
    const limitedOffset = applyPanLimit({ x: offsetX, y: offsetY }, clampedZoom)

    setOverscroll({ x: 0, y: 0 }) // オーバースクロールがあればリセット
    setZoom(clampedZoom)
    setPanOffset(limitedOffset)
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

  // 現在のコンテナとコンテンツサイズに基づいて、画面に収まる最小倍率を計算
  const getFitToScreenZoom = useCallback(() => {
    if (!containerRef.current || !canvasRef?.current) return minFitZoom

    const container = containerRef.current
    const canvas = canvasRef.current

    // 0除算防止
    const contentWidth = canvas.clientWidth || canvas.width
    const contentHeight = canvas.clientHeight || canvas.height
    if (contentWidth === 0 || contentHeight === 0) return minFitZoom

    // マージン考慮（任意、ここではぴったり合わせるためマージンなし、あるいは定数定義）
    // fitToScreen関数ではMARGIN=10を使っているが、最小リミットとしては0マージンで計算
    const scaleX = container.clientWidth / contentWidth
    const scaleY = container.clientHeight / contentHeight

    return Math.min(scaleX, scaleY)
  }, [containerRef, canvasRef, minFitZoom])


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

        // 動的な最小倍率（Fitサイズ）を取得
        const dynamicMinZoom = getFitToScreenZoom()

        // プリレンダリング: zoom範囲 dynamicMinZoom ～ 2.0 (1000%)
        let newZoom = Math.max(dynamicMinZoom, Math.min(2.0, oldZoom + delta))

        // ... (省略なし) ...
        const containerRect = containerRef.current.getBoundingClientRect()
        const cursorX = e.clientX - containerRect.left
        const cursorY = e.clientY - containerRect.top
        setLastWheelCursor({ x: e.clientX, y: e.clientY })

        const scaleRatio = newZoom / oldZoom
        const newPanOffsetX = cursorX - (cursorX - panOffset.x) * scaleRatio
        const newPanOffsetY = cursorY - (cursorY - panOffset.y) * scaleRatio

        // パン制限を適用（PDFが画面外に消えないように）
        const limitedOffset = applyPanLimit({ x: newPanOffsetX, y: newPanOffsetY }, newZoom)

        setZoom(newZoom)
        setPanOffset(limitedOffset)
      }
    }

    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      document.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, zoom, panOffset, minFitZoom, onResetToFit, getFitToScreenZoom]) // getFitToScreenZoomを依存配列に追加

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
    getFitToScreenZoom // 追加エクスポート
  }
}
