/**
 * なげなわ選択機能（Lasso Selection）- 改良版
 * 
 * 既存のストロークをペン/マウスで1秒間長押しすると、
 * そのストロークが閉じたループ（始点と終点が近い）かをチェックし、
 * ループであればその中のストロークを選択モードで移動可能にする。
 * 
 * 仕様:
 * - ストロークを長押し（1秒）で選択モード発動
 * - ループ内のストロークを選択
 * - ドラッグで移動可能
 * - 3秒間無操作でモード終了、ループストロークを削除
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import type { DrawingPath, DrawingPoint, SelectionState } from '../types'

/** 長押し認識に必要な時間（ミリ秒） */
const LONG_PRESS_DURATION = 1000

/** 選択モード自動終了までの時間（ミリ秒） */
const INACTIVITY_TIMEOUT = 3000

/** 始点と終点がこの距離以下なら閉じたループとみなす（正規化座標） */
const CLOSE_THRESHOLD = 0.05

/** パスが選択されたとみなすために、ポイントの何割がループ内にあればよいか */
const SELECTION_RATIO = 0.5

interface UseLassoSelectionOptions {
    /** 長押し時間（ミリ秒） */
    longPressDuration?: number
    /** 無操作タイムアウト（ミリ秒） */
    inactivityTimeout?: number
    /** 閉じたループとみなす閾値（正規化座標） */
    closeThreshold?: number
    /** 選択判定の閾値（割合） */
    selectionRatio?: number
    /** 選択モード発動時のコールバック（描画キャンセル用） */
    onSelectionActivate?: () => void
}

/**
 * 点がポリゴン内にあるかどうかを判定（Ray Casting Algorithm）
 */
const isPointInPolygon = (point: DrawingPoint, polygon: DrawingPoint[]): boolean => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y
        const xj = polygon[j].x, yj = polygon[j].y
        if ((yi > point.y) !== (yj > point.y) &&
            point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

/**
 * パスが閉じたループかどうかを判定
 */
const isClosedLoop = (path: DrawingPath, threshold: number): boolean => {
    if (path.points.length < 10) return false // 短すぎるパスはループではない

    const first = path.points[0]
    const last = path.points[path.points.length - 1]
    const dist = Math.hypot(last.x - first.x, last.y - first.y)
    return dist < threshold
}

/**
 * パスがループ内に含まれているかを判定
 */
const isPathInsideLasso = (
    path: DrawingPath,
    lassoPoints: DrawingPoint[],
    ratio: number
): boolean => {
    if (path.points.length === 0) return false

    let insideCount = 0
    for (const point of path.points) {
        if (isPointInPolygon(point, lassoPoints)) {
            insideCount++
        }
    }

    return insideCount / path.points.length >= ratio
}

/**
 * 点がどのストローク上にあるかを判定
 * @returns ストロークのインデックス、見つからない場合は -1
 */
const findStrokeAtPoint = (
    point: DrawingPoint,
    paths: DrawingPath[],
    hitRadius: number = 0.02
): number => {
    for (let i = paths.length - 1; i >= 0; i--) {
        const path = paths[i]
        for (const p of path.points) {
            const dist = Math.hypot(p.x - point.x, p.y - point.y)
            if (dist < hitRadius) {
                return i
            }
        }
    }
    return -1
}

/**
 * パスのバウンディングボックスを計算
 */
const calculateBoundingBox = (paths: DrawingPath[], indices: number[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const idx of indices) {
        const path = paths[idx]
        if (!path) continue
        for (const point of path.points) {
            minX = Math.min(minX, point.x)
            minY = Math.min(minY, point.y)
            maxX = Math.max(maxX, point.x)
            maxY = Math.max(maxY, point.y)
        }
    }

    if (minX === Infinity) return null
    return { minX, minY, maxX, maxY }
}

/**
 * なげなわ選択フック（改良版）
 */
export const useLassoSelection = (
    paths: DrawingPath[],
    onPathsChange: (paths: DrawingPath[]) => void,
    options: UseLassoSelectionOptions = {}
) => {
    const {
        longPressDuration = LONG_PRESS_DURATION,
        inactivityTimeout = INACTIVITY_TIMEOUT,
        closeThreshold = CLOSE_THRESHOLD,
        selectionRatio = SELECTION_RATIO,
        onSelectionActivate
    } = options

    const [selectionState, setSelectionState] = useState<SelectionState>({
        lassoPath: null,
        lassoStrokeIndex: -1,
        selectedIndices: [],
        boundingBox: null,
        isDragging: false,
        dragStart: null
    })

    // 長押し検出用
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const longPressStartPointRef = useRef<DrawingPoint | null>(null)
    const longPressStrokeIndexRef = useRef<number>(-1)

    // 無操作タイムアウト用
    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // ラッソストロークのインデックス（削除用）
    const lassoStrokeIndexRef = useRef<number>(-1)

    // 元パス保存（移動時の参照用）
    const originalPathsRef = useRef<DrawingPath[]>([])

    // pathsのref（タイマーコールバック内で最新を参照）
    const pathsRef = useRef(paths)
    useEffect(() => {
        pathsRef.current = paths
    }, [paths])

    /**
     * 選択モードを終了（共通の解除処理）
     * - タイマーをクリア
     * - ラッソストロークを削除
     * - 選択状態をリセット
     * 
     * どのような理由で解除されても、この関数が呼ばれる
     */
    const clearSelection = useCallback(() => {
        // タイマーをクリア
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current)
            inactivityTimerRef.current = null
        }

        // ラッソストロークを削除
        const currentPaths = pathsRef.current
        const lassoIdx = lassoStrokeIndexRef.current
        if (lassoIdx >= 0 && lassoIdx < currentPaths.length) {
            const newPaths = currentPaths.filter((_, i) => i !== lassoIdx)
            onPathsChange(newPaths)
        }

        // 選択状態をリセット
        setSelectionState({
            lassoPath: null,
            lassoStrokeIndex: -1,
            selectedIndices: [],
            boundingBox: null,
            isDragging: false,
            dragStart: null
        })
        lassoStrokeIndexRef.current = -1
        originalPathsRef.current = []
    }, [onPathsChange])

    // clearSelectionのref（タイマーコールバック内で最新を参照）
    const clearSelectionRef = useRef(clearSelection)
    useEffect(() => {
        clearSelectionRef.current = clearSelection
    }, [clearSelection])

    /**
     * 無操作タイマーをリセット
     * タイムアウト時はclearSelectionを呼び出す
     */
    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current)
        }
        inactivityTimerRef.current = setTimeout(() => {
            // タイムアウト：共通の解除処理を呼び出す
            clearSelectionRef.current()
        }, inactivityTimeout)
    }, [inactivityTimeout])

    /**
     * 長押し開始（ポインターダウン時に呼ぶ）
     */
    const startLongPress = useCallback((point: DrawingPoint) => {
        // 既に選択中の場合は長押し検出しない
        if (selectionState.selectedIndices.length > 0) {
            return
        }

        // タイマーをクリア
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
        }

        // どのストロークの上か判定
        const strokeIndex = findStrokeAtPoint(point, paths)
        if (strokeIndex < 0) {
            // ストローク上でない場合は何もしない
            longPressStartPointRef.current = null
            longPressStrokeIndexRef.current = -1
            return
        }

        longPressStartPointRef.current = point
        longPressStrokeIndexRef.current = strokeIndex

        // 1秒後に選択モード発動を試みる
        longPressTimerRef.current = setTimeout(() => {
            const targetPath = pathsRef.current[strokeIndex]
            if (!targetPath) return

            // 閉じたループかチェック
            if (!isClosedLoop(targetPath, closeThreshold)) {
                // ループでなければ何もしない
                return
            }

            // ループ内のストロークを検索
            const selectedIndices: number[] = []
            for (let i = 0; i < pathsRef.current.length; i++) {
                if (i === strokeIndex) continue // ラッソ自身は選択しない
                if (isPathInsideLasso(pathsRef.current[i], targetPath.points, selectionRatio)) {
                    selectedIndices.push(i)
                }
            }

            if (selectedIndices.length === 0) {
                // 何も選択されなかった
                return
            }

            // 選択モード発動
            const boundingBox = calculateBoundingBox(pathsRef.current, selectedIndices)
            lassoStrokeIndexRef.current = strokeIndex

            // 長押し開始位置を取得（ドラッグ開始位置として使用）
            const startPoint = longPressStartPointRef.current

            // 描画をキャンセル（ドラッグ軌跡が描画されないように）
            if (onSelectionActivate) {
                onSelectionActivate()
            }

            setSelectionState({
                lassoPath: targetPath,
                lassoStrokeIndex: strokeIndex,
                selectedIndices,
                boundingBox,
                // 長押し後すぐにドラッグできるようにする
                isDragging: true,
                dragStart: startPoint
            })

            // 元のパスを保存（ラッソストロークも含む）
            originalPathsRef.current = pathsRef.current.map(p => ({
                ...p,
                points: [...p.points.map(pt => ({ ...pt }))]
            }))

            // 無操作タイマー開始
            resetInactivityTimer()

        }, longPressDuration)
    }, [paths, selectionState.selectedIndices.length, closeThreshold, selectionRatio, longPressDuration, resetInactivityTimer])

    /**
     * 長押しキャンセル（ポインター移動 or アップ時）
     */
    const cancelLongPress = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        longPressStartPointRef.current = null
        longPressStrokeIndexRef.current = -1
    }, [])

    /**
     * ポインター移動時に呼ぶ（長押しキャンセル判定）
     */
    const checkLongPressMove = useCallback((point: DrawingPoint, threshold: number = 0.01) => {
        if (!longPressStartPointRef.current) return

        const dx = point.x - longPressStartPointRef.current.x
        const dy = point.y - longPressStartPointRef.current.y
        const dist = Math.hypot(dx, dy)

        if (dist > threshold) {
            // 移動したらキャンセル
            cancelLongPress()
        }
    }, [cancelLongPress])

    /**
     * 点がラッソストローク（輪）上にあるか判定
     * 輪をドラッグして中のストロークを移動させるため
     */
    const isPointInSelection = useCallback((point: DrawingPoint): boolean => {
        const { lassoStrokeIndex, selectedIndices } = selectionState
        if (selectedIndices.length === 0 || lassoStrokeIndex < 0) return false

        // ラッソストローク上にあるかチェック
        const lasso = paths[lassoStrokeIndex]
        if (!lasso) return false

        for (const p of lasso.points) {
            const dist = Math.hypot(p.x - point.x, p.y - point.y)
            if (dist < 0.02) { // ヒット判定半径
                return true
            }
        }
        return false
    }, [selectionState, paths])

    /**
     * ドラッグ開始
     */
    const startDrag = useCallback((point: DrawingPoint) => {
        if (selectionState.selectedIndices.length === 0) return

        // 無操作タイマーリセット
        resetInactivityTimer()

        setSelectionState(prev => ({
            ...prev,
            isDragging: true,
            dragStart: point
        }))
    }, [selectionState.selectedIndices.length, resetInactivityTimer])

    /**
     * ドラッグ中の移動
     */
    const drag = useCallback((point: DrawingPoint) => {
        if (!selectionState.isDragging || !selectionState.dragStart) return

        // 無操作タイマーリセット
        resetInactivityTimer()

        const dx = point.x - selectionState.dragStart.x
        const dy = point.y - selectionState.dragStart.y

        const lassoIdx = selectionState.lassoStrokeIndex

        // 選択されたパスとラッソストロークを移動
        const newPaths = paths.map((path, idx) => {
            // ラッソストロークも移動対象に含める
            const isLasso = idx === lassoIdx
            const isSelected = selectionState.selectedIndices.includes(idx)

            if (!isLasso && !isSelected) {
                return path
            }

            const originalPath = originalPathsRef.current[idx]
            if (!originalPath) return path

            return {
                ...path,
                points: originalPath.points.map(pt => ({
                    x: pt.x + dx,
                    y: pt.y + dy
                }))
            }
        })

        onPathsChange(newPaths)
    }, [selectionState, paths, onPathsChange, resetInactivityTimer])

    /**
     * ドラッグ終了
     */
    const endDrag = useCallback(() => {
        if (!selectionState.isDragging) return

        // 無操作タイマーリセット
        resetInactivityTimer()

        // dragStartを更新して、次のドラッグに備える
        setSelectionState(prev => ({
            ...prev,
            isDragging: false,
            dragStart: null,
            // バウンディングボックスを再計算
            boundingBox: calculateBoundingBox(paths, prev.selectedIndices)
        }))

        // 現在のパスを元パスとして保存
        originalPathsRef.current = paths.map(p => ({
            ...p,
            points: [...p.points.map(pt => ({ ...pt }))]
        }))
    }, [selectionState.isDragging, paths, resetInactivityTimer])

    /**
     * 選択中かどうか
     */
    const hasSelection = selectionState.selectedIndices.length > 0

    // クリーンアップ
    useEffect(() => {
        return () => {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current)
            }
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current)
            }
        }
    }, [])

    return {
        selectionState,
        hasSelection,
        startLongPress,
        cancelLongPress,
        checkLongPressMove,
        isPointInSelection,
        startDrag,
        drag,
        endDrag,
        clearSelection,
        // 後方互換性のため（使用しないが、呼び出し元でエラーにならないよう）
        checkForLasso: () => false
    }
}
