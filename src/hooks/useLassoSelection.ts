/**
 * なげなわ選択機能（Lasso Selection）
 * 
 * ペンモードで閉じたループを描くと、ループ内のストロークを選択し、
 * ドラッグで移動できる機能を提供する。
 */
import { useState, useCallback, useRef } from 'react'
import type { DrawingPath, DrawingPoint, SelectionState } from '../types'

interface UseLassoSelectionOptions {
    /** 始点と終点の距離がこの閾値以下ならループとみなす（正規化座標） */
    closeThreshold?: number
    /** パスが選択されたとみなすために、ポイントの何割がループ内にあればよいか */
    selectionRatio?: number
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
 * パスのポイントの一定割合以上がループ内にあれば選択とみなす
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
 * なげなわ選択フック
 */
export const useLassoSelection = (
    paths: DrawingPath[],
    onPathsChange: (paths: DrawingPath[]) => void,
    options: UseLassoSelectionOptions = {}
) => {
    const { closeThreshold = 0.05, selectionRatio = 0.5 } = options

    const [selectionState, setSelectionState] = useState<SelectionState>({
        lassoPath: null,
        selectedIndices: [],
        boundingBox: null,
        isDragging: false,
        dragStart: null
    })

    const originalPathsRef = useRef<DrawingPath[]>([])

    /**
     * 描画が完了した時に呼ばれる。ループならtrueを返す。
     */
    const checkForLasso = useCallback((path: DrawingPath): boolean => {
        if (!isClosedLoop(path, closeThreshold)) {
            return false
        }

        // ループ内のパスを検索
        const selectedIndices: number[] = []
        for (let i = 0; i < paths.length; i++) {
            if (isPathInsideLasso(paths[i], path.points, selectionRatio)) {
                selectedIndices.push(i)
            }
        }

        if (selectedIndices.length === 0) {
            return false // 何も選択されなかった
        }

        // 選択状態を設定
        const boundingBox = calculateBoundingBox(paths, selectedIndices)
        setSelectionState({
            lassoPath: path,
            selectedIndices,
            boundingBox,
            isDragging: false,
            dragStart: null
        })

        // 元のパスを保存（移動時の参照用）
        originalPathsRef.current = paths.map(p => ({
            ...p,
            points: [...p.points.map(pt => ({ ...pt }))]
        }))

        return true
    }, [paths, closeThreshold, selectionRatio])

    /**
     * 点が選択範囲（バウンディングボックス）内にあるか判定
     */
    const isPointInSelection = useCallback((point: DrawingPoint): boolean => {
        const { boundingBox } = selectionState
        if (!boundingBox) return false

        // バウンディングボックスに少しマージンを追加
        const margin = 0.02
        return (
            point.x >= boundingBox.minX - margin &&
            point.x <= boundingBox.maxX + margin &&
            point.y >= boundingBox.minY - margin &&
            point.y <= boundingBox.maxY + margin
        )
    }, [selectionState])

    /**
     * ドラッグ開始
     */
    const startDrag = useCallback((point: DrawingPoint) => {
        if (selectionState.selectedIndices.length === 0) return

        setSelectionState(prev => ({
            ...prev,
            isDragging: true,
            dragStart: point
        }))
    }, [selectionState.selectedIndices.length])

    /**
     * ドラッグ中の移動
     */
    const drag = useCallback((point: DrawingPoint) => {
        if (!selectionState.isDragging || !selectionState.dragStart) return

        const dx = point.x - selectionState.dragStart.x
        const dy = point.y - selectionState.dragStart.y

        // 選択されたパスを移動
        const newPaths = paths.map((path, idx) => {
            if (!selectionState.selectedIndices.includes(idx)) {
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
    }, [selectionState, paths, onPathsChange])

    /**
     * ドラッグ終了
     */
    const endDrag = useCallback(() => {
        if (!selectionState.isDragging) return

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
    }, [selectionState.isDragging, paths])

    /**
     * 選択を解除
     */
    const clearSelection = useCallback(() => {
        setSelectionState({
            lassoPath: null,
            selectedIndices: [],
            boundingBox: null,
            isDragging: false,
            dragStart: null
        })
        originalPathsRef.current = []
    }, [])

    /**
     * 選択中かどうか
     */
    const hasSelection = selectionState.selectedIndices.length > 0

    return {
        selectionState,
        hasSelection,
        checkForLasso,
        isPointInSelection,
        startDrag,
        drag,
        endDrag,
        clearSelection
    }
}
