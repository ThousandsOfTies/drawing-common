import React, { useRef, useEffect, useState, useMemo } from 'react'
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
    // Static Canvas: 保存された線を表示（React State駆動）
    const staticCanvasRef = useRef<HTMLCanvasElement>(null)
    // Live Canvas: 現在描いている線のみを表示（Interaction駆動）
    const liveCanvasRef = useRef<HTMLCanvasElement>(null)

    // 親コンポーネントには静的キャンバス（保存済みデータ）を公開
    React.useImperativeHandle(ref, () => staticCanvasRef.current!)

    const isDrawing = tool === 'pen'
    const isErasing = tool === 'eraser'
    const hasSelection = selectionState && selectionState.selectedIndices.length > 0
    const isInteractive = !isCtrlPressed && (isDrawing || isErasing)

    // 2本指タップ検出用
    const twoFingerTapStartRef = useRef<{ time: number, dist: number } | null>(null)
    const lastPathTimeRef = useRef(0)

    // useDrawing hook (Live Layerに描画)
    const {
        isDrawing: isCurrentlyDrawing,
        startDrawing: hookStartDrawing,
        draw: hookContinueDrawing,
        drawBatch,
        stopDrawing: hookStopDrawing,
        cancelDrawing: hookCancelDrawing
    } = useDrawing(liveCanvasRef, {
        width: size,
        color,
        onPathComplete: (path) => {
            const now = Date.now()
            if (now - lastPathTimeRef.current < 50) {
                addDebugLog(`⚠️ Ignored Double Path (${now - lastPathTimeRef.current}ms)`)
                return
            }
            lastPathTimeRef.current = now

            addDebugLog(`🎁 Path Added (pts=${path.points.length})`)

            // なげなわ選択
            if (onLassoComplete && onLassoComplete(path)) {
                // Live Canvasをクリア
                const ctx = liveCanvasRef.current?.getContext('2d')
                if (ctx && liveCanvasRef.current) ctx.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height)
                return
            }
            onPathAdd?.(path)

            // 描画完了後、Live Canvas（上層）をクリアして、Static Canvas（下層）への反映と交代する
            const ctx = liveCanvasRef.current?.getContext('2d')
            if (ctx && liveCanvasRef.current) {
                // 明示的にクリア
                ctx.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height)
            }
        },
        // スクラッチ完了時
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

            // Live Canvasクリア
            const ctx = liveCanvasRef.current?.getContext('2d')
            if (ctx && liveCanvasRef.current) {
                ctx.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height)
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

    // Debug paths updates
    useEffect(() => {
        if (paths.length > 0) {
            addDebugLog(`🔄 Paths Update: ${paths.length}`)
        }
    }, [paths.length])

    // 再描画ロジック（Static Layer / pathsが変わった時）
    useEffect(() => {
        const canvas = staticCanvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // 常にクリアして再描画
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // ラッソストロークのインデックス
        const lassoIdx = selectionState?.lassoStrokeIndex ?? -1

        paths.forEach((path, index) => {
            if (index === lassoIdx) return

            ctx.beginPath()
            const isSelected = selectionState?.selectedIndices.includes(index)
            ctx.strokeStyle = isSelected ? '#3498db' : path.color
            ctx.lineWidth = path.width

            if (path.points.length > 0) {
                const w = canvas.width
                const h = canvas.height

                // 開始点
                ctx.moveTo(path.points[0].x * w, path.points[0].y * h)

                if (path.points.length < 3) {
                    // 直線 (2点)
                    for (let i = 1; i < path.points.length; i++) {
                        ctx.lineTo(path.points[i].x * w, path.points[i].y * h)
                    }
                } else {
                    // Catmull-Rom Spline (Interpolating Spline)
                    // useDrawing.ts (Live Layer) と同じロジックを使用して、WYSIWYGを実現

                    for (let i = 0; i < path.points.length - 1; i++) {
                        const p0 = path.points[i - 1] || path.points[i]
                        const p1 = path.points[i]
                        const p2 = path.points[i + 1]
                        const p3 = path.points[i + 2] || p2

                        const p0x = p0.x * w, p0y = p0.y * h
                        const p1x = p1.x * w, p1y = p1.y * h
                        const p2x = p2.x * w, p2y = p2.y * h
                        const p3x = p3.x * w, p3y = p3.y * h

                        // Catmull-Rom -> Cubic Bezier Conversion
                        const cp1x = p1x + (p2x - p0x) / 6
                        const cp1y = p1y + (p2y - p0y) / 6

                        const cp2x = p2x - (p3x - p1x) / 6
                        const cp2y = p2y - (p3y - p1y) / 6

                        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2x, p2y)
                    }
                }
                ctx.stroke()
            }
        })

        // ラッソストローク (Static Layer)
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
    }, [paths, width, height, selectionState])

    // Canvas座標変換ヘルパー
    const toCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent | PointerEvent): { x: number, y: number } | null => {
        const canvas = liveCanvasRef.current
        if (!canvas) return null

        const rect = canvas.getBoundingClientRect()
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY

        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        }
    }

    const isStylusTouch = (touch: React.Touch): boolean => {
        return (touch as any).touchType === 'stylus'
    }

    // イベントハンドラ (Live Canvas操作)
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

    const handleEraserDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isErasing || !isInteractive) return
        const coords = toCanvasCoordinates(e)
        if (coords) {
            const canvas = liveCanvasRef.current
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
            const canvas = liveCanvasRef.current
            const isPressed = 'touches' in e || (e as React.MouseEvent).buttons === 1
            if (isPressed && canvas) {
                hookEraseAtPosition(canvas, coords.x, coords.y, paths)
            }
        }
    }

    const handleEraserUp = () => {
        if (!isErasing || !isInteractive) return
        hookStopErasing()
        // 消しゴム終了時もLive Canvasをクリア
        const ctx = liveCanvasRef.current?.getContext('2d')
        if (ctx && liveCanvasRef.current) {
            ctx.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height)
        }
    }

    // 正規化座標へ変換
    const toNormalizedCoordinates = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent): DrawingPoint | null => {
        const coords = toCanvasCoordinates(e)
        if (!coords) return null
        const canvas = liveCanvasRef.current // Live Canvas基準
        if (!canvas) return null
        return {
            x: coords.x / canvas.width,
            y: coords.y / canvas.height
        }
    }

    // --- VISUAL DEBUGGING START ---
    const [debugLogs, setDebugLogs] = useState<string[]>([])
    const addDebugLog = (msg: string) => {
        setDebugLogs(prev => [`${new Date().toLocaleTimeString().split(' ')[0]}.${new Date().getMilliseconds()} ${msg}`, ...prev].slice(0, 15))
    }
    const instanceId = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase(), [])
    // --- VISUAL DEBUGGING END ---

    // 統合ハンドラ: Pointer Events
    const handlePointerDown = (e: React.PointerEvent) => {
        addDebugLog(`⬇️ Down: ${e.pointerType}`)

        // Strict Strict Pen Mode (stylusOnly時はペン以外完全遮断)
        if (stylusOnly && isDrawing && e.pointerType !== 'pen') {
            addDebugLog(`🚫 BLOCKED (Not Pen): ${e.pointerType}`)
            // return // DISABLED for debugging
        }

        console.log('[DrawingCanvas] PointerDown', { type: e.pointerType, tool, isDrawing })
        addDebugLog(`✅ ALLOWED Down: ${e.pointerType}`)

        if (hasSelection && isDrawing) {
            const point = toNormalizedCoordinates(e)
            if (!point) return

            const bb = selectionState?.boundingBox
            if (bb && point.x >= bb.minX && point.x <= bb.maxX && point.y >= bb.minY && point.y <= bb.maxY) {
                (e.target as Element).setPointerCapture(e.pointerId)
                onSelectionDragStart?.(point)
                return
            }
            onSelectionClear?.()
            return
        }

        if (isDrawing) {
            if (isInteractive) {
                const coords = toCanvasCoordinates(e)
                if (coords) {
                    (e.target as Element).setPointerCapture(e.pointerId)
                    addDebugLog(`🖊️ Start: ${Math.round(coords.x)},${Math.round(coords.y)}`)
                    hookStartDrawing(coords.x, coords.y)
                } else {
                    addDebugLog(`❌ Start Fail: No Coords`)
                }
            }
        } else if (isErasing) {
            if (isInteractive) {
                const coords = toCanvasCoordinates(e)
                if (coords && liveCanvasRef.current) {
                    (e.target as Element).setPointerCapture(e.pointerId)
                    hookStartErasing()
                    hookEraseAtPosition(liveCanvasRef.current, coords.x, coords.y, paths)
                }
            }
        }
    }



    const handlePointerMove = (e: React.PointerEvent) => {
        // Strict Mode Check Removed (Debugging)
        // if (stylusOnly && isDrawing && isInteractive && e.pointerType !== 'pen' && (e.buttons === 1 || e.pressure > 0)) {
        //     // Only log if it would have been a drawing move
        //     // addDebugLog(`🚫 Move Blocked: ${e.pointerType}`)
        //     // return
        // }

        if (isDrawing) {
            if (isInteractive && (e.buttons === 1 || e.pointerType === 'touch' || e.pointerType === 'pen')) {
                const coords = toCanvasCoordinates(e)
                // Use coalesced events for higher precision
                // @ts-ignore
                const events = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) as React.PointerEvent[]

                if (coords) {
                    events.forEach((ev: React.PointerEvent) => {
                        const c = toCanvasCoordinates(ev)
                        if (c) {
                            hookContinueDrawing(c.x, c.y)
                        } else {
                            // addDebugLog('❌ Move: Invalid Coords')
                        }
                    })
                } else {
                    addDebugLog('❌ Move: No Coords')
                }

                if (hasSelection) {
                    const point = toNormalizedCoordinates(e)
                    if (point && selectionState?.isDragging) {
                        onSelectionDrag?.(point)
                    }
                }
            }
        } else if (isErasing) {
            if (isInteractive) {
                const coords = toCanvasCoordinates(e)
                if (coords && liveCanvasRef.current) {
                    // Check button state for mouse (touch/pen usually implied by move if down? no, need pressed check)
                    // For pointer events, buttons===1 means primary button (touch/pen contact)
                    if (e.buttons === 1) {
                        // Coalesced support for eraser too?
                        // @ts-ignore
                        const events = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) as React.PointerEvent[]
                        events.forEach((ev: React.PointerEvent) => {
                            const c = toCanvasCoordinates(ev)
                            if (c) hookEraseAtPosition(liveCanvasRef.current!, c.x, c.y, paths)
                        })
                    }
                }
            }
        }
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        addDebugLog(`⬆️ Up: ${e.pointerType}`)
        // Strict Mode Check
        if (stylusOnly && isDrawing && e.pointerType !== 'pen') {
            addDebugLog(`🚫 Up Blocked: ${e.pointerType}`)
            return
        }
        addDebugLog(`✅ ALLOWED Up: ${e.pointerType}`)

        if ((e.target as Element).hasPointerCapture(e.pointerId)) {
            (e.target as Element).releasePointerCapture(e.pointerId)
        }

        if (selectionState?.isDragging) {
            onSelectionDragEnd?.()
            return
        }

        if (isDrawing) {
            if (isInteractive) {
                hookStopDrawing()
                addDebugLog(`🏁 Stroke Finished`)
            }
        } else if (isErasing) {
            if (isInteractive) {
                hookStopErasing()
                const ctx = liveCanvasRef.current?.getContext('2d')
                if (ctx && liveCanvasRef.current) {
                    ctx.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height)
                }
            }
        }
    }



    return (
        <div style={{ position: 'relative', width, height, touchAction: 'none' }} className={className}>
            {/* Visual Debug Overlay */}
            <div style={{
                position: 'fixed', // Fixed to viewport
                top: 100,
                left: 20,
                background: 'rgba(0, 0, 0, 0.85)',
                color: '#0f0',
                padding: '12px',
                borderRadius: '8px',
                pointerEvents: 'none',
                zIndex: 99999,
                fontSize: '16px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxWidth: '400px',
                maxHeight: '400px',
                overflowY: 'auto', // Scrollable
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}>
                <div style={{ fontSize: '16px', borderBottom: '1px solid #444', marginBottom: '4px' }}>ID: {instanceId}</div>
                <div style={{ fontSize: '14px', marginBottom: '4px' }}>Paths: {paths.length}</div>
                {debugLogs.map((log, i) => (
                    <div key={i}>{log}</div>
                ))}
            </div>

            <canvas
                ref={staticCanvasRef}
                width={width}
                height={height}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
            />
            <canvas
                ref={liveCanvasRef}
                width={width}
                height={height}
                style={{ position: 'absolute', top: 0, left: 0, zIndex: 2, touchAction: 'none', pointerEvents: 'all' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
            />
        </div>
    )
})
