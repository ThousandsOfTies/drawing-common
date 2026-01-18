import React, { useRef, useEffect, useState } from 'react'
import { useDrawing, doPathsIntersect } from '../hooks/useDrawing'
import { useEraser } from '../hooks/useEraser'
import { DrawingPath, DrawingPoint, SelectionState } from '../types'

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

    // イベント
    onPathAdd: (path: DrawingPath) => void
    onPathsChange?: (paths: DrawingPath[]) => void // 消しゴムで消された時など
    onUndo?: () => void     // 2本指タップでのUndo
}

export const DrawingCanvas = React.forwardRef<HTMLCanvasElement, DrawingCanvasProps>(({
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

    // 親コンポーネントに内部のcanvas要素を公開
    React.useImperativeHandle(ref, () => canvasRef.current!)

    const isDrawing = tool === 'pen'
    const isErasing = tool === 'eraser'
    const hasSelection = selectionState && selectionState.selectedIndices.length > 0
    const isInteractive = !isCtrlPressed && (isDrawing || isErasing)

    // 2本指タップ検出用
    const twoFingerTapStartRef = useRef<{ time: number, dist: number } | null>(null)
    const lastPathTimeRef = useRef(0)
    const isTouchActiveRef = useRef(false)

    // useDrawing hook
    const {
        isDrawing: isCurrentlyDrawing,
        startDrawing: hookStartDrawing,
        draw: hookContinueDrawing,
        stopDrawing: hookStopDrawing
    } = useDrawing(canvasRef, {
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
    })

    // useEraser hook
    const {
        startErasing: hookStartErasing,
        eraseAtPosition: hookEraseAtPosition,
        stopErasing: hookStopErasing
    } = useEraser(eraserSize, (newPaths) => {
        onPathsChange?.(newPaths)
    })

    // 再描画ロジック（pathsが変わった時）
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // 常にクリアして再描画
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // ラッソストロークのインデックス（別途破線で描画するためスキップ）
        const lassoIdx = selectionState?.lassoStrokeIndex ?? -1

        paths.forEach((path, index) => {
            // ラッソストロークはここではスキップ（後で破線として描画）
            if (index === lassoIdx) return

            ctx.beginPath()
            // 選択されたパスは青でハイライト
            const isSelected = selectionState?.selectedIndices.includes(index)
            ctx.strokeStyle = isSelected ? '#3498db' : path.color
            ctx.lineWidth = path.width

            if (path.points.length > 0) {
                ctx.moveTo(path.points[0].x * canvas.width, path.points[0].y * canvas.height)
                path.points.forEach((point, idx) => {
                    if (idx > 0) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
                })
                ctx.stroke()
            }
        })

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

        // バウンディングボックスは表示しない（ユーザー要望）
    }, [paths, width, height, selectionState])

    // Canvas座標変換ヘルパー
    const toCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number, y: number } | null => {
        const canvas = canvasRef.current
        if (!canvas) return null

        const rect = canvas.getBoundingClientRect()
        // タッチイベントの場合は最初のタッチポイントを使用
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY

        // 視覚的なサイズと内部バッファサイズの比率を計算
        // (高解像度ディスプレイやRENDER_SCALEによる拡大縮小を補正)
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        }
    }

    // タッチがスタイラスかどうか判定（指のみを弾くため）
    const isStylusTouch = (touch: React.Touch): boolean => {
        // @ts-ignore: touchTypeは標準プロパティだがTypeScript定義に含まれない場合がある
        return touch.touchType === 'stylus'
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
        // ただし消しゴムモードの場合は指でも操作可能としたい場合はここを調整
        if (stylusOnly && isDrawing && e.touches.length > 0) {
            const touch = e.touches[0]
            if (!isStylusTouch(touch)) {
                return // 描画しない
            }
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

        if (isDrawing) handlePenDown(e)
        else if (isErasing) handleEraserDown(e)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        // パームリジェクション
        if (stylusOnly && isDrawing && e.touches.length > 0) {
            const touch = e.touches[0]
            if (!isStylusTouch(touch)) {
                return
            }
        }

        // 選択をドラッグ中
        if (selectionState?.isDragging) {
            const point = toNormalizedCoordinates(e)
            if (point) onSelectionDrag?.(point)
            return
        }

        if (isDrawing) handlePenMove(e)
        else if (isErasing) handleEraserMove(e)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        // 重複防止フラグ解除（遅延）
        setTimeout(() => isTouchActiveRef.current = false, 500)

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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        />
    )
})

