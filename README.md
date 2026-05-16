# Paper Reviewer PDF Splitter

React + Vite + pdf.js で、PDFをページ画像に分割するMVPです。

## 実装済み

- PDFファイルのドラッグ&ドロップ
- PDFファイル選択
- PDFをブラウザ内でページごとのPNG画像に分割
- ページ画像一覧
- ページ画像プレビュー
- 採用 / 除外
- ページごとのレビューコメント
- ページ単体PNGダウンロード
- 採用ページのPNG一括ダウンロード
- 採用ページのmanifest JSON書き出し
- 進捗バー

## 起動方法

```bash
npm install
npm run dev
```

表示されたローカルURLを開いてください。

## 実装メモ

PDFの画像化は `src/App.jsx` の `splitPdfIntoImages()` で実装しています。

```js
const result = await splitPdfIntoImages(file, {
  scale: 1.8,
  imageType: "image/png",
  onProgress: setProgress
});
```

`scale` を上げると高解像度になりますが、メモリ使用量が増えます。

## 次の実装ステップ

1. 生成されたページ画像をバックエンドへ渡す
2. PyMuPDF / LayoutParser / OpenCV などで Figure/Table 候補領域を検出
3. 候補領域だけをcropしてレビューUIに表示
4. 採用された図表候補をGoogle Sheetsへ貼り付け
