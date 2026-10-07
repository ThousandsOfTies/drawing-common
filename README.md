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

## CanvasのUndoと座標計算

`CanvasUndoHistory<T>` は描画操作の直前に `push(canvas, state)` で保存し、`undo(canvas)` で画素と対応するメタデータを復元します。最後の画像1枚と、それ以前の画像との差分を保持するため、小さな筆跡や文字だけの編集で画像全体のバッファが増えません。戻せる件数に上限は設けません。広い範囲が変わった場合は画像全体を逆差分として保持するので、常に一定のメモリ量になる方式ではありません。

`state` は呼び出し元が不変のスナップショットとして渡します。背景や文字の描画は呼び出し元が管理します。新しい問題を開くときは `clear()` で履歴を解放します。IndexedDBの保存形式は扱いません。`byteLength` は保持する画素・差分位置の配列のバイト数で、ブラウザ全体のメモリ使用量ではありません。

`zoomAtPoint`、`touchPair`、`pinchViewport` は、ホイールやピンチ操作の座標計算を共有する関数です。対象の画面やペインの選択、イベントの受付は呼び出し元が管理します。

`npm test` で描画・拡大縮小・画素とメタデータのUndoを検証し、`npm run build` で型と公開ファイルを確認します。

## License

MIT
