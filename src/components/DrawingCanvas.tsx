import React, { useRef, useEffect } from 'react'
import { useDrawing, doPathsIntersect } from '../hooks/useDrawing'
import { useStrokeInput } from '../hooks/useStrokeInput'
import { useEraser } from '../hooks/useEraser'
import { DrawingPath, DrawingPoint, SelectionState, DrawingCanvasHandle, StrokeStyle } from '../types'
import { drawDrawingPath } from '../rendering/drawDrawingPath'
import { drawStationaryStroke } from '../rendering/drawStationaryStroke'

// カーソルとアイコン用のSVG定義（icons.tsx準拠）
const ICON_SVG = {
    penCursor: (color: string) => {
        const encodedColor = color.replace('#', '%23')
        return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='${encodedColor}' d='M3,17.25V21h3.75L17.81,9.94l-3.75-3.75L3,17.25z M20.71,7.04c0.39-0.39,0.39-1.02,0-1.41l-2.34-2.34 c-0.39-0.39-1.02-0.39-1.41,0l-1.83,1.83l3.75,3.75L20.71,7.04z'/></svg>") 2 20, crosshair`
    },
    eraserCursor: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect fill='%232196F3' x='5' y='3' width='14' height='14' rx='1'/><rect fill='white' stroke='%23666' stroke-width='1' x='6' y='17' width='12' height='4' rx='0.5'/><line stroke='%231976D2' stroke-width='0.5' x1='7' y1='10' x2='17' y2='10'/></svg>") 12 12, pointer`
}

export interface DrawingCanvasProps {
    width?: number
    height?: number
    /** Stable logical coordinate size when the backing bitmap is rendered at another resolution. */
    coordinateWidth?: number
    coordinateHeight?: number
    className?: string
    style?: React.CSSProperties

    // 状態
    tool: 'pen' | 'eraser' | 'fill'
    color: string
    size: number
    opacity?: number
    strokeStyle?: StrokeStyle
    eraserSize: number
    paths: DrawingPath[]
    previewPath?: DrawingPath | null
    isCtrlPressed?: boolean // パン操作用（Ctrl押下時は描画無効）
    stylusOnly?: boolean    // パームリジェクション（Apple Pencilのみ描画許可）
    isDrawingExternal?: boolean // 親コンポーネントの描画状態（キャンバス再描画の制御用）

    // なげなわ選択（オプション）
    selectionState?: SelectionState | null
    onLassoComplete?: (path: DrawingPath) => boolean // trueを返すとパスを追加しない
    onSelectionDragStart?: (point: DrawingPoint) => void
    onSelectionDrag?: (point: DrawingPoint) => void
    onSelectionDragEnd?: () => void
    onSelectionClear?: () => void

    // インタラクションモード
    interactionMode?: 'full' | 'display-only' // 'display-only'時は内部useDrawingを無効化

    // イベント
    onPathAdd: (path: DrawingPath) => void
    onPathsChange?: (paths: DrawingPath[]) => void // 消しゴムで消された時など
    onUndo?: () => void     // 2本指タップでのUndo
}


export const DrawingCanvas = React.forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(({
    width,
    height,
    coordinateWidth,
    coordinateHeight,
    className,
    style,
    tool,
    color,
    size,
    opacity = 1,
    strokeStyle = 'pencil',
    eraserSize,
    paths,
    previewPath = null,
    isCtrlPressed = false,
    stylusOnly = false,
    isDrawingExternal = false,
    selectionState = null,
    interactionMode = 'full',
    onLassoComplete,
    onSelectionDragStart,
    onSelectionDrag,
    onSelectionDragEnd,
    onSelectionClear,
    onPathAdd,
    onPathsChange,
    onUndo
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement>(null)
    // 半透明ストロークの自己重なりを防ぐための再利用レイヤー。
    // ストロークごとに巨大な canvas を生成しない。
    const transparencyLayerRef = useRef<HTMLCanvasElement | null>(null)
    const wasDrawingExternalRef = useRef(false)
    const getCoordinateSize = () => {
        const canvas = canvasRef.current
        if (!canvas) return null
        return {
            width: coordinateWidth || canvas.width,
            height: coordinateHeight || canvas.height,
        }
    }
    const getBitmapScale = (canvas: HTMLCanvasElement) => ({
        x: canvas.width / Math.max(coordinateWidth || canvas.width, 1),
        y: canvas.height / Math.max(coordinateHeight || canvas.height, 1),
    })

    // 描画メソッドの実装
    const drawStroke = (points: { x: number, y: number }[], color: string, width: number, strokeOpacity = 1) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const bitmapScale = getBitmapScale(canvas)
        const widthScale = Math.min(bitmapScale.x, bitmapScale.y)

        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = color
        ctx.globalAlpha = strokeOpacity
        ctx.lineWidth = width * widthScale

        if (drawStationaryStroke(ctx, points, width, { scaleX: bitmapScale.x, scaleY: bitmapScale.y, widthScale })) {
            ctx.restore()
            return
        }
        if (points.length < 2) {
            ctx.restore()
            return
        }

        ctx.beginPath()
        const start = points[0]
        ctx.moveTo(start.x * bitmapScale.x, start.y * bitmapScale.y)

        for (let i = 1; i < points.length; i++) {
            const p = points[i]
            ctx.lineTo(p.x * bitmapScale.x, p.y * bitmapScale.y)
        }
        ctx.stroke()
        ctx.restore()
    }

    const fillAtBitmapPosition = (x: number, y: number, color: string, fillOpacity = 1) => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = image.data
        const start = (Math.floor(y) * canvas.width + Math.floor(x)) * 4
        // ペンの上ではなく、透明な領域だけを塗る。
        if (data[start + 3] > 10) return
        const match = color.match(/^#([0-9a-f]{6})$/i)
        if (!match) return
        const hex = match[1]
        const rgba = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), Math.round(fillOpacity * 255)]
        const stack: Array<[number, number]> = [[Math.floor(x), Math.floor(y)]]
        while (stack.length) {
            const [px, py] = stack.pop()!
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue
            const index = (py * canvas.width + px) * 4
            if (data[index + 3] > 10) continue
            data[index] = rgba[0]; data[index + 1] = rgba[1]; data[index + 2] = rgba[2]; data[index + 3] = rgba[3]
            stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
        }
        ctx.putImageData(image, 0, 0)
    }

    const fillAt = (x: number, y: number, color: string, fillOpacity = 1) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const bitmapScale = getBitmapScale(canvas)
        fillAtBitmapPosition(x * bitmapScale.x, y * bitmapScale.y, color, fillOpacity)
    }

    // 親コンポーネントに内部のcanvas要素と描画メソッドを公開
    React.useImperativeHandle(ref, () => ({
        getSize: getCoordinateSize,
        drawStroke,
        fillAt
    }))

    // useDrawing用のハンドルRef（内部使用）
    // NOTE: DrawingCanvasHandleを実装したオブジェクトをRefとして渡す
    const internalHandleRef = {
        current: {
            getSize: getCoordinateSize,
            drawStroke,
            fillAt
        }
    }


    const isDrawing = tool === 'pen'
    const isErasing = tool === 'eraser'
    const hasSelection = selectionState && selectionState.selectedIndices.length > 0
    const isInteractive = !isCtrlPressed && (isDrawing || isErasing)

    // 2本指タップ検出用
    const twoFingerTapStartRef = useRef<{ time: number, dist: number } | null>(null)

    // Pointer Events用：アクティブなポインタを追跡
    const activePointerIdRef = useRef<number | null>(null)
    const activeTouchPointersRef = useRef<Set<number>>(new Set())

    // useDrawing hook (display-onlyモードでは無効化)
    const drawingHookResult = interactionMode === 'full' ? useDrawing(internalHandleRef, {
        width: size,
        color,
        opacity,
        style: strokeStyle,
        onPathComplete: (path) => {
            // なげなわ選択が有効で、ループとして認識された場合はパスを追加しない
            if (onLassoComplete && onLassoComplete(path)) {
                return
            }
            onPathAdd(path)
        },
        // スクラッチ完了時：交差するパスを削除
        onScratchComplete: (scratchPath) => {
            if (!onPathsChange) return

            // 交差するパスを削除
            const pathsToKeep = paths.filter(existingPath =>
                !doPathsIntersect(scratchPath, existingPath)
            )

            // 交差があった場合のみ更新
            if (pathsToKeep.length < paths.length) {
                onPathsChange(pathsToKeep)
            }
        }
    }) : {
        isDrawing: false,
        startDrawing: () => { },
        draw: () => { },
        stopDrawing: () => { }
    }

    const {
        startDrawing: hookStartDrawing,
        stopDrawing: hookStopDrawing
    } = drawingHookResult

    // useEraser hook
    const {
        startErasing: hookStartErasing,
        eraseAtPosition: hookEraseAtPosition,
        stopErasing: hookStopErasing
    } = useEraser(eraserSize, (newPaths) => {
        onPathsChange?.(newPaths)
    })

    // 描画済みのパス数を記憶（差分描画用）
    const renderedPathCountRef = useRef(0)

    // 再描画ロジック（pathsが変わった時）
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const bitmapScale = getBitmapScale(canvas)
        const widthScale = Math.min(bitmapScale.x, bitmapScale.y)

        const wasDrawingExternal = wasDrawingExternalRef.current
        wasDrawingExternalRef.current = isDrawingExternal

        // 描画開始時は既存キャンバスを消さず、入力に追従する差分描画をそのまま使う。
        // 描画終了時には、ライブ描画を消して保存済みの幅（両端の細さを含む）で描き直す。
        if (isDrawingExternal && !wasDrawingExternal) return
        const justFinishedExternalDrawing = !isDrawingExternal && wasDrawingExternal

        // 描画スタイル設定（共通）
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // ラッソストロークのインデックス（別途破線で描画するためスキップ）
        const lassoIdx = selectionState?.lassoStrokeIndex ?? -1

        // --- 差分描画判定 ---
        const currentPathCount = paths.length
        const prevPathCount = renderedPathCountRef.current

        // 全再描画が必要な条件:
        // 1. パスが減った (Undo / 消しゴム)
        // 2. パス数が変わらずとも内容が変わった可能性（簡易判定として長さが同じでも全描画の方が安全だが、今回はUndo検知を主眼）
        // 3. 選択状態が変わった (ハイライト表示のため)
        // 4. キャンバスサイズが変わった (依存配列で検知される)
        // 5. 外部から強制再描画フラグが来た場合 (今回はPropsにないが念頭に置く)
        // NOTE: selectionStateが変わると常にフル描画になる。選択操作中はこれは妥当。

        let startIndex = 0
        const isIncremental = currentPathCount > prevPathCount && prevPathCount > 0
        const needsFullRedraw =
            currentPathCount < prevPathCount || // Undo/Eraser
            selectionState || // Selection active (highlighting changes)
            lassoIdx !== -1 || // Lasso active
            prevPathCount === 0 || // Initial render
            justFinishedExternalDrawing;

        if (!needsFullRedraw && isIncremental) {
            // 差分描画: 前回描画した続きから描く
            startIndex = prevPathCount
        } else {
            // 全描画: クリアする
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            startIndex = 0
        }

        // 描画ループ
        for (let i = startIndex; i < currentPathCount; i++) {
            const path = paths[i]
            // ラッソストロークはスキップ
            if (i === lassoIdx) continue

            if (path.kind === 'fill') {
                const point = path.points[0]
                if (point) fillAtBitmapPosition(point.x * canvas.width, point.y * canvas.height, path.color, path.opacity ?? 1)
                continue
            }

            // 選択されたパスは青でハイライト
            const isSelected = selectionState?.selectedIndices.includes(i)
            const pathOpacity = isSelected ? 1 : (path.opacity ?? 1)
            if (path.points.length === 0) continue
            drawDrawingPath(ctx, path, { scaleX: canvas.width, scaleY: canvas.height, widthScale }, {
                color: isSelected ? '#3498db' : path.color, opacity: pathOpacity, layer: transparencyLayerRef,
            })
        }
        ctx.globalAlpha = 1

        // ラッソストロークを破線で描画（選択モード中のみ）
        if (lassoIdx >= 0 && lassoIdx < paths.length) {
            const lasso = paths[lassoIdx]
            ctx.strokeStyle = 'rgba(52, 152, 219, 0.7)'
            ctx.lineWidth = lasso.width * widthScale
            ctx.setLineDash([6, 4])
            ctx.beginPath()
            if (lasso.points.length > 0) {
                ctx.moveTo(lasso.points[0].x * canvas.width, lasso.points[0].y * canvas.height)
                lasso.points.forEach((point, idx) => {
                    if (idx > 0) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
                })
                ctx.closePath()
                ctx.stroke()
            }
            ctx.setLineDash([])
        }

        // 描画済みカウントを更新
        renderedPathCountRef.current = currentPathCount

    }, [paths, width, height, coordinateWidth, coordinateHeight, selectionState, isDrawingExternal])

    // Canvas座標変換ヘルパー（PointerEvent / MouseEvent / TouchEvent対応）
    const toCanvasCoordinates = (
        e: React.MouseEvent | React.PointerEvent | React.TouchEvent,
        specificTouch?: React.Touch | null
    ): { x: number, y: number } | null => {
        const canvas = canvasRef.current
        if (!canvas) return null

        const rect = canvas.getBoundingClientRect()

        // 特定のタッチが指定されている場合はそれを使用
        let clientX: number
        let clientY: number

        if (specificTouch) {
            clientX = specificTouch.clientX
            clientY = specificTouch.clientY
        } else if ('touches' in e && e.touches.length > 0) {
            // タッチイベントの場合は最初のタッチポイントを使用
            clientX = e.touches[0].clientX
            clientY = e.touches[0].clientY
        } else if ('clientX' in e && 'clientY' in e) {
            // PointerEventまたはMouseEventの場合（両方ともclientX/Yを持つ）
            clientX = e.clientX
            clientY = e.clientY
        } else {
            return null
        }

        // 視覚的なサイズと高解像度bitmapの比率を計算
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        }
    }


    // 消しゴム用ハンドラ
    const handleEraserDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isErasing || !isInteractive) return
        const coords = toCanvasCoordinates(e)
        if (coords) {
            const canvas = canvasRef.current
            if (canvas) {
                hookStartErasing()
                hookEraseAtPosition(canvas, coords.x, coords.y, paths)
            }
        }
    }

    const handleEraserMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isErasing || !isInteractive) return
        const coords = toCanvasCoordinates(e)
        if (coords) {
            const canvas = canvasRef.current
            // マウスボタンが押されているかチェック（タッチの場合は常に押されているとみなす）
            const isPressed = 'touches' in e || (e as React.MouseEvent).buttons === 1
            if (isPressed && canvas) {
                hookEraseAtPosition(canvas, coords.x, coords.y, paths)
            }
        }
    }

    const handleEraserUp = () => {
        if (!isErasing || !isInteractive) return
        hookStopErasing()
    }

    // 正規化座標へ変換（0-1）
    const toNormalizedCoordinates = (e: React.MouseEvent | React.TouchEvent): DrawingPoint | null => {
        const coords = toCanvasCoordinates(e)
        if (!coords) return null
        const canvas = canvasRef.current
        if (!canvas) return null
        return {
            x: coords.x / canvas.width,
            y: coords.y / canvas.height
        }
    }

    const strokeInput = useStrokeInput({
        eventTargetRef: canvasRef,
        enabled: interactionMode === 'full' && isDrawing && isInteractive && !hasSelection,
        pointerTouchDrawing: true,
        onStart: point => {
            const canvas = canvasRef.current
            if (!canvas) return false
            const rect = canvas.getBoundingClientRect()
            hookStartDrawing((point.clientX - rect.left) * canvas.width / rect.width,
                (point.clientY - rect.top) * canvas.height / rect.height, point.pressure, point.time)
        },
        onMove: points => {
            const canvas = canvasRef.current
            if (!canvas || !('drawBatch' in drawingHookResult)) return
            const rect = canvas.getBoundingClientRect()
            drawingHookResult.drawBatch(points.map(point => ({
                x: (point.clientX - rect.left) * canvas.width / rect.width,
                y: (point.clientY - rect.top) * canvas.height / rect.height,
                pressure: point.pressure, time: point.time,
            })))
        },
        onEnd: () => hookStopDrawing(),
    })

    // Pointer Event handlers (優先使用 - タッチとペンを正しく区別)
    const handlePointerDown = (e: React.PointerEvent) => {
        // タッチポインタを追跡（2本指タップUndo用）
        if (e.pointerType === 'touch') {
            activeTouchPointersRef.current.add(e.pointerId)

            // 2本指タップUndo検出
            if (activeTouchPointersRef.current.size === 2) {
                twoFingerTapStartRef.current = {
                    time: Date.now(),
                    dist: 0 // PointerEventsでは距離計算が複雑なため簡略化
                }
                return // 描画はしない
            }
        }

        // stylusOnlyモードでペン以外のポインタを無視
        if (stylusOnly && isDrawing && e.pointerType !== 'pen') {
            return
        }

        if (isDrawing && !hasSelection) {
            if (strokeInput.onPointerDown(e)) activePointerIdRef.current = e.pointerId
            return
        }

        // 既にアクティブなポインタがある場合は無視（単一ポインタのみサポート）
        if (activePointerIdRef.current !== null) {
            return
        }

        // このポインタを追跡開始
        activePointerIdRef.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)

        // 選択中の場合
        if (hasSelection && isDrawing) {
            const point = toNormalizedCoordinates(e)
            if (!point) return

            // バウンディングボックス内なら移動開始
            const bb = selectionState?.boundingBox
            if (bb && point.x >= bb.minX && point.x <= bb.maxX && point.y >= bb.minY && point.y <= bb.maxY) {
                onSelectionDragStart?.(point)
                return
            }

            // バウンディングボックス外なら選択解除
            onSelectionClear?.()
            return
        }

        if (isErasing) {
            handleEraserDown(e)
        }
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        // アクティブなポインタでない場合は無視
        if (activePointerIdRef.current !== e.pointerId) {
            return
        }

        // 選択をドラッグ中
        if (selectionState?.isDragging) {
            const point = toNormalizedCoordinates(e)
            if (point) onSelectionDrag?.(point)
            return
        }

        if (isDrawing) {
            strokeInput.onPointerMove(e)
        } else if (isErasing) {
            handleEraserMove(e)
        }
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        // タッチポインタの追跡を解除
        if (e.pointerType === 'touch') {
            activeTouchPointersRef.current.delete(e.pointerId)

            // 2本指タップUndo判定
            if (twoFingerTapStartRef.current && onUndo && activeTouchPointersRef.current.size === 0) {
                const now = Date.now()
                const diff = now - twoFingerTapStartRef.current.time

                // 300ms以内ならUndoとみなす
                if (diff < 300) {
                    onUndo()
                    twoFingerTapStartRef.current = null
                    return
                }
                twoFingerTapStartRef.current = null
            }
        }

        // アクティブなポインタでない場合は無視
        if (activePointerIdRef.current !== e.pointerId) {
            return
        }

        if (isDrawing && !hasSelection && !strokeInput.onPointerUp(e)) return

        // ポインタ追跡を終了
        activePointerIdRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
        }

        // 選択ドラッグ終了
        if (selectionState?.isDragging) {
            onSelectionDragEnd?.()
            return
        }

        if (isErasing) handleEraserUp()
    }

    const handlePointerCancel = (e: React.PointerEvent) => {
        // ポインタがキャンセルされた場合（画面外に出た等）
        if (activePointerIdRef.current === e.pointerId) {
            if (isDrawing && !hasSelection && !strokeInput.onPointerCancel(e)) return
            activePointerIdRef.current = null
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
            }

            if (selectionState?.isDragging) {
                onSelectionDragEnd?.()
            } else if (isErasing) {
                handleEraserUp()
            }
        }
    }

    useEffect(() => {
        const canvas = previewCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const bitmapScale = getBitmapScale(canvas)
        const widthScale = Math.min(bitmapScale.x, bitmapScale.y)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (!previewPath?.points.length) return

        drawDrawingPath(ctx, previewPath, { scaleX: canvas.width, scaleY: canvas.height, widthScale }, { opacity: 1 })
    }, [previewPath, width, height, coordinateWidth, coordinateHeight])

    return (
        <>
          <canvas
            ref={canvasRef}
            className={className}
            width={width}
            height={height}
            style={{
                cursor: isInteractive
                    ? (isDrawing ? ICON_SVG.penCursor(color) : ICON_SVG.eraserCursor)
                    : 'default',
                touchAction: 'none',
                ...style
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={event => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) handlePointerCancel(event)
            }}
          />
          <canvas
            ref={previewCanvasRef}
            className={className}
            width={width}
            height={height}
            aria-hidden="true"
            style={{ ...style, pointerEvents: 'none', opacity: previewPath?.opacity ?? 1 }}
          />
        </>
    )
})
