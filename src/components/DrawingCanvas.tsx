import React, { useRef, useEffect, useState } from 'react'
import { useDrawing, doPathsIntersect } from '../hooks/useDrawing'
import { useEraser } from '../hooks/useEraser'
import { DrawingPath, DrawingPoint, SelectionState, DrawingCanvasHandle } from '../types'

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
    className?: string
    style?: React.CSSProperties

    // 状態
    tool: 'pen' | 'eraser'
    color: string
    size: number
    eraserSize: number
    paths: DrawingPath[]
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
    className,
    style,
    tool,
    color,
    size,
    eraserSize,
    paths,
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

    // 描画メソッドの実装
    const drawStroke = (points: { x: number, y: number }[], color: string, width: number) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = color
        ctx.lineWidth = width

        if (points.length < 2) return

        ctx.beginPath()
        const start = points[0]
        ctx.moveTo(start.x, start.y)

        for (let i = 1; i < points.length; i++) {
            const p = points[i]
            ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
    }

    // 親コンポーネントに内部のcanvas要素と描画メソッドを公開
    React.useImperativeHandle(ref, () => ({
        getCanvas: () => canvasRef.current,
        drawStroke
    }))

    // useDrawing用のハンドルRef（内部使用）
    // NOTE: DrawingCanvasHandleを実装したオブジェクトをRefとして渡す
    const internalHandleRef = {
        current: {
            getCanvas: () => canvasRef.current,
            drawStroke
        }
    }


    const isDrawing = tool === 'pen'
    const isErasing = tool === 'eraser'
    const hasSelection = selectionState && selectionState.selectedIndices.length > 0
    const isInteractive = !isCtrlPressed && (isDrawing || isErasing)

    // 2本指タップ検出用
    const twoFingerTapStartRef = useRef<{ time: number, dist: number } | null>(null)
    const lastPathTimeRef = useRef(0)
    const isTouchActiveRef = useRef(false)

    // Pointer Events用：アクティブなポインタを追跡
    const activePointerIdRef = useRef<number | null>(null)
    const activeTouchPointersRef = useRef<Set<number>>(new Set())

    // useDrawing hook (display-onlyモードでは無効化)
    const drawingHookResult = interactionMode === 'full' ? useDrawing(internalHandleRef, {
        width: size,
        color,
        onPathComplete: (path) => {
            const now = Date.now()
            if (now - lastPathTimeRef.current < 50) {
                return
            }
            lastPathTimeRef.current = now

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
        isDrawing: isCurrentlyDrawing,
        startDrawing: hookStartDrawing,
        draw: hookContinueDrawing,
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
            prevPathCount === 0; // Initial render

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

            ctx.beginPath()
            // 選択されたパスは青でハイライト
            const isSelected = selectionState?.selectedIndices.includes(i)
            ctx.strokeStyle = isSelected ? '#3498db' : path.color
            ctx.lineWidth = path.width

            if (path.points.length > 0) {
                const pts = path.points
                if (pts.length === 1) {
                    // 1点の場合は点を描画
                    ctx.beginPath()
                    ctx.arc(pts[0].x * canvas.width, pts[0].y * canvas.height, path.width / 2, 0, Math.PI * 2)
                    ctx.fillStyle = ctx.strokeStyle
                    ctx.fill()
                } else if (pts.length === 2) {
                    // 2点の場合は直線
                    ctx.moveTo(pts[0].x * canvas.width, pts[0].y * canvas.height)
                    ctx.lineTo(pts[1].x * canvas.width, pts[1].y * canvas.height)
                    ctx.stroke()
                } else {
                    // 3点以上：quadraticCurveToで滑らかなカーブ
                    ctx.moveTo(pts[0].x * canvas.width, pts[0].y * canvas.height)

                    for (let j = 1; j < pts.length - 1; j++) {
                        const p1 = pts[j]
                        const p2 = pts[j + 1]
                        // 制御点は現在の点、終点は次の点との中間点
                        const cpX = p1.x * canvas.width
                        const cpY = p1.y * canvas.height
                        const endX = (p1.x + p2.x) / 2 * canvas.width
                        const endY = (p1.y + p2.y) / 2 * canvas.height
                        ctx.quadraticCurveTo(cpX, cpY, endX, endY)
                    }
                    // 最後の点まで描画
                    const lastPt = pts[pts.length - 1]
                    ctx.lineTo(lastPt.x * canvas.width, lastPt.y * canvas.height)
                    ctx.stroke()
                }
            }
        }

        // ラッソストロークを破線で描画（選択モード中のみ）
        if (lassoIdx >= 0 && lassoIdx < paths.length) {
            const lasso = paths[lassoIdx]
            ctx.strokeStyle = 'rgba(52, 152, 219, 0.7)'
            ctx.lineWidth = lasso.width
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

    }, [paths, width, height, selectionState, isDrawingExternal])

    // タッチがスタイラスかどうか判定（指のみを弾くため）
    const isStylusTouch = (touch: React.Touch): boolean => {
        // @ts-ignore: touchTypeは標準プロパティだがTypeScript定義に含まれない場合がある
        return touch.touchType === 'stylus'
    }

    // タッチリストからスタイラスタッチを見つける
    const findStylusTouch = (touches: React.TouchList): React.Touch | null => {
        for (let i = 0; i < touches.length; i++) {
            if (isStylusTouch(touches[i])) {
                return touches[i]
            }
        }
        return null
    }

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

        // 視覚的なサイズと内部バッファサイズの比率を計算
        // (高解像度ディスプレイやRENDER_SCALEによる拡大縮小を補正)
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        }
    }

    // ペン用ハンドラ
    const handlePenDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !isInteractive) return
        const coords = toCanvasCoordinates(e)
        if (coords) hookStartDrawing(coords.x, coords.y)
    }

    const handlePenMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !isInteractive) return
        const coords = toCanvasCoordinates(e)
        if (coords) hookContinueDrawing(coords.x, coords.y)
    }

    const handlePenUp = () => {
        if (!isDrawing || !isInteractive) return
        hookStopDrawing()
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

    // 統合ハンドラ: マウス
    const handleMouseDown = (e: React.MouseEvent) => {
        // タッチ操作中はマウスイベントを無視
        if (isTouchActiveRef.current) return

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

        if (isDrawing) handlePenDown(e)
        else if (isErasing) handleEraserDown(e)
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isTouchActiveRef.current) return

        // 選択をドラッグ中
        if (selectionState?.isDragging) {
            const point = toNormalizedCoordinates(e)
            if (point) onSelectionDrag?.(point)
            return
        }

        if (isDrawing) handlePenMove(e)
        else if (isErasing) handleEraserMove(e)
    }

    const handleMouseUp = (e: React.MouseEvent) => {
        // 選択ドラッグ終了
        if (selectionState?.isDragging) {
            onSelectionDragEnd?.()
            return
        }

        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

    const handleMouseLeave = (e: React.MouseEvent) => {
        // 画面外に出たときは描画終了
        if (selectionState?.isDragging) {
            onSelectionDragEnd?.()
            return
        }
        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

    // 統合ハンドラ: タッチ
    const handleTouchStart = (e: React.TouchEvent) => {
        isTouchActiveRef.current = true

        // 2本指タップUndo検出
        if (e.touches.length === 2) {
            const t1 = e.touches[0]
            const t2 = e.touches[1]
            const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
            twoFingerTapStartRef.current = {
                time: Date.now(),
                dist: dist
            }
            return // 描画はしない
        }

        // パームリジェクション: stylusOnlyかつ指の場合は無視
        // マルチタッチ対応：複数のタッチからスタイラスを探す
        let targetTouch: React.Touch | null = null
        if (stylusOnly && isDrawing && e.touches.length > 0) {
            targetTouch = findStylusTouch(e.touches)
            if (!targetTouch) {
                return // スタイラスが見つからない場合は無視
            }
        } else if (e.touches.length > 0) {
            // stylusOnlyが無効な場合は最初のタッチを使用
            targetTouch = e.touches[0]
        }

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

        if (isDrawing) {
            const coords = toCanvasCoordinates(e, targetTouch)
            if (coords) hookStartDrawing(coords.x, coords.y)
        } else if (isErasing) {
            handleEraserDown(e)
        }
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        // パームリジェクション: マルチタッチ対応：複数のタッチからスタイラスを探す
        let targetTouch: React.Touch | null = null
        if (stylusOnly && isDrawing && e.touches.length > 0) {
            targetTouch = findStylusTouch(e.touches)
            if (!targetTouch) {
                return // スタイラスが見つからない場合は無視
            }
        } else if (e.touches.length > 0) {
            targetTouch = e.touches[0]
        }

        // 選択をドラッグ中
        if (selectionState?.isDragging) {
            const point = toNormalizedCoordinates(e)
            if (point) onSelectionDrag?.(point)
            return
        }

        if (isDrawing) {
            const coords = toCanvasCoordinates(e, targetTouch)
            if (coords) hookContinueDrawing(coords.x, coords.y)
        } else if (isErasing) {
            handleEraserMove(e)
        }
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        // 重複防止フラグ解除（しない：一度タッチ操作をしたらマウスは永続的に無視）
        // setTimeout(() => isTouchActiveRef.current = false, 500)

        // 選択ドラッグ終了
        if (selectionState?.isDragging) {
            onSelectionDragEnd?.()
            return
        }

        // 2本指タップUndo判定
        if (twoFingerTapStartRef.current && onUndo) {
            // 指が離れたタイミング
            const now = Date.now()
            const diff = now - twoFingerTapStartRef.current.time

            // 300ms以内ならUndoとみなす
            // 距離変化チェックは touchmove を追跡する必要があるが、簡易的に時間だけでも十分実用的
            // もし移動していたら touchmove でスクロールなどが走っているはず
            if (diff < 300) {
                // 2本とも離れたか、あるいは1本離れた時点で発火
                onUndo()
                twoFingerTapStartRef.current = null
                return
            }
            // 時間切れならリセット
            twoFingerTapStartRef.current = null
        }

        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

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

        if (isDrawing) {
            const coords = toCanvasCoordinates(e)
            if (coords) hookStartDrawing(coords.x, coords.y)
        } else if (isErasing) {
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

        if (isDrawing && isCurrentlyDrawing) {
            const canvas = canvasRef.current
            if (!canvas) return

            const rect = canvas.getBoundingClientRect()

            // Coalesced Events の取得（Apple Pencil の追従性向上）
            let events: PointerEvent[] = []
            if (typeof e.nativeEvent.getCoalescedEvents === 'function') {
                events = e.nativeEvent.getCoalescedEvents()
            } else {
                events = [e.nativeEvent]
            }

            // すべての Coalesced Events から座標を抽出
            const batchPoints: Array<{ x: number, y: number }> = []

            for (const ev of events) {
                // Canvas座標に変換
                const scaleX = canvas.width / rect.width
                const scaleY = canvas.height / rect.height
                const x = (ev.clientX - rect.left) * scaleX
                const y = (ev.clientY - rect.top) * scaleY
                batchPoints.push({ x, y })
            }

            // Coalesced Events を一括処理
            if (batchPoints.length > 0 && 'drawBatch' in drawingHookResult) {
                drawingHookResult.drawBatch(batchPoints)
            } else if (batchPoints.length > 0) {
                // drawBatchがない場合はフォールバック
                const coords = toCanvasCoordinates(e)
                if (coords) hookContinueDrawing(coords.x, coords.y)
            }
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

        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

    const handlePointerCancel = (e: React.PointerEvent) => {
        // ポインタがキャンセルされた場合（画面外に出た等）
        if (activePointerIdRef.current === e.pointerId) {
            activePointerIdRef.current = null
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
            }

            if (selectionState?.isDragging) {
                onSelectionDragEnd?.()
            } else if (isDrawing) {
                handlePenUp()
            } else if (isErasing) {
                handleEraserUp()
            }
        }
    }

    return (
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
        />
    )
})

