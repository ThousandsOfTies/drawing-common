# @thousands-of-ties/drawing-common

共通の描画ツール・コンポーネントライブラリ

## Features

- ✅ Canvas描画機能（ペン）
- ✅ スクラッチ消しゴム機能
- ✅ Apple Pencil対応
- ✅ 正規化座標（レスポンシブ対応）
- ✅ TypeScript完全対応

## Installation

```bash
npm install @thousands-of-ties/drawing-common
```

## Usage

```typescript
import { useDrawing, type DrawingPath } from '@thousands-of-ties/drawing-common'

function MyComponent() {
  const {
    drawingPaths,
    isCurrentlyDrawing,
    startDrawing,
    continueDrawing,
    stopDrawing,
    redrawPaths
  } = useDrawing(pageNum)

  // Canvas描画処理
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    startDrawing(canvas, x, y, '#000000', 2)
  }

  return <canvas ref={canvasRef} onMouseDown={handleMouseDown} />
}
```

## License

MIT
