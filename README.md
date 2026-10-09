# @thousands-of-ties/drawing-common

TutoTuto・DoriDori・CopiCopiで使う、Canvas描画の共通React・TypeScriptライブラリです。

## 主な機能

- ペン・消しゴム・投げ縄選択、描画キャンバスとポインター操作。
- ズーム・パン・ピンチの座標計算。
- 画素の差分を利用する `CanvasUndoHistory` と、描画に対応する状態のUndo。
- PDF・解答画面の入力を扱う `useStrokeInput`。ペン・マウス・Touchの識別、開始と終了、重複する入力点を共通で管理する。

描画結果の保存、アプリ固有の画材・レイヤー・背景などは呼び出し元で管理します。

`useStrokeInput` には描画面の `eventTargetRef` を渡します。PencilのTouch入力を非passiveで受け、ブラウザの標準ジェスチャーとの競合を防ぎます。URLに `?strokeDebug=1` を付けると、共通ツールバーで端末内の入力記録を確認・コピーできます。

## 利用方法

各メタリポジトリがGitサブモジュールとしてコミットを固定します。3アプリはVite・TypeScriptのエイリアスで、兄弟ディレクトリの `src` を参照します。

```typescript
import { DrawingCanvas, CanvasUndoHistory } from '@thousands-of-ties/drawing-common'
```

公開APIは [src/index.ts](src/index.ts)、引数や型は各実装を参照してください。

## 開発・検証

```bash
npm install
npm test
npm run build
```

変更時は3アプリの型チェック・ビルドで互換性も確認し、このリポジトリをcommit・pushしてから各メタのgitlinkを更新します。

ライセンス: MIT
