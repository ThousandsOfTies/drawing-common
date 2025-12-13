import React, { useRef, useEffect, useState } from 'react'
import { useDrawing } from '../hooks/useDrawing'
import { useEraser } from '../hooks/useEraser'
import { DrawingPath } from '../types'

// カーソルとアイコン用のSVG定義
const ICON_SVG = {
    penCursor: (color: string) => {
        const svg = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 17L17 7M17 7L17 11M17 7L13 7" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="2" cy="22" r="2" fill="${color}"/>
      </svg>
    `
        return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 0 24, auto`
    },
    eraserCursor: `url('data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="16" height="16" stroke="black" stroke-width="2" fill="white"/>
      <path d="M8 8L16 16M16 8L8 16" stroke="black" stroke-width="2"/>
    </svg>
  `)}') 12 12, auto`
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

    // イベント
    onPathAdd: (path: DrawingPath) => void
    onPathsChange?: (paths: DrawingPath[]) => void // 消しゴムで消された時など
    onUndo?: () => void     // 2本指タップでのUndo
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
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
    onPathAdd,
    onPathsChange,
    onUndo
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawing = tool === 'pen'
    const isErasing = tool === 'eraser'
    const isInteractive = !isCtrlPressed && (isDrawing || isErasing)

    // 2本指タップ検出用
    const twoFingerTapStartRef = useRef<{ time: number, dist: number } | null>(null)

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
            onPathAdd(path)
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

        if (isCurrentlyDrawing) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        paths.forEach(path => {
            ctx.beginPath()
            ctx.strokeStyle = path.color
            ctx.lineWidth = path.width

            if (path.points.length > 0) {
                ctx.moveTo(path.points[0].x * canvas.width, path.points[0].y * canvas.height)
                path.points.forEach((point, index) => {
                    if (index > 0) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
                })
                ctx.stroke()
            }
        })
    }, [paths, width, height, isCurrentlyDrawing])

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


    // 統合ハンドラ: マウス
    const handleMouseDown = (e: React.MouseEvent) => {
        if (isDrawing) handlePenDown(e)
        else if (isErasing) handleEraserDown(e)
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDrawing) handlePenMove(e)
        else if (isErasing) handleEraserMove(e)
    }

    const handleMouseUp = (e: React.MouseEvent) => {
        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

    const handleMouseLeave = (e: React.MouseEvent) => {
        // 画面外に出たときは描画終了
        if (isDrawing) handlePenUp()
        else if (isErasing) handleEraserUp()
    }

    // 統合ハンドラ: タッチ
    const handleTouchStart = (e: React.TouchEvent) => {
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

        if (isDrawing) handlePenMove(e)
        else if (isErasing) handleEraserMove(e)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
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
}
