import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Upload,
  FileText,
  Download,
  RotateCcw,
  Image as ImageIcon,
  Images,
  Check,
  X,
  Search,
  Sparkles,
  ZoomIn,
  Layers,
  LayoutGrid,
  ClipboardCopy,
  Table
} from "lucide-react";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import "./styles.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function makeDownloadName(fileName, pageNumber, extension = "png") {
  const baseName = fileName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
  return `${baseName}_page_${String(pageNumber).padStart(3, "0")}.${extension}`;
}

function dataUrlToBlob(dataUrl) {
  const i = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, i);
  const b64 = dataUrl.slice(i + 1);
  const mimeMatch = /^data:([^;]+)/u.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let k = 0; k < len; k += 1) bytes[k] = binary.charCodeAt(k);
  return new Blob([bytes], { type: mime });
}

function escapeTsvField(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function makeEmbeddedDownloadName(fileName, pageNumber, seq, extension = "png") {
  const baseName = fileName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
  return `${baseName}_p${String(pageNumber).padStart(3, "0")}_img_${String(seq).padStart(3, "0")}.${extension}`;
}

function ordinalFromEmbedId(id) {
  const n = Number(String(id).replace(/^embed-/u, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function makeSheetRowFileName(fileName, rowIndex, kind, pageNumber, embedOrdinal = null) {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
  const pg = String(pageNumber).padStart(3, "0");
  const ri = String(rowIndex).padStart(3, "0");
  if (kind === "page") return `${base}_sheet_${ri}_page_p${pg}.png`;
  return `${base}_sheet_${ri}_img_p${pg}_n${String(embedOrdinal).padStart(3, "0")}.png`;
}

function buildSheetExportRows(fileName, pages, embeddedImages, { includePages, includeImages }) {
  const selPages = pages.filter((p) => p.selected);
  const selImages = embeddedImages.filter((e) => e.selected);
  if (!includePages && !includeImages) return [];

  const imagesByPage = new Map();
  for (const img of selImages) {
    if (!imagesByPage.has(img.pageNumber)) imagesByPage.set(img.pageNumber, []);
    imagesByPage.get(img.pageNumber).push(img);
  }
  for (const list of imagesByPage.values()) {
    list.sort((a, b) => ordinalFromEmbedId(a.id) - ordinalFromEmbedId(b.id));
  }

  const pageNums = new Set();
  if (includePages) for (const p of selPages) pageNums.add(p.pageNumber);
  if (includeImages) for (const e of selImages) pageNums.add(e.pageNumber);
  const sortedNums = [...pageNums].sort((a, b) => a - b);

  const rows = [];
  let rowIndex = 0;

  for (const pn of sortedNums) {
    if (includePages) {
      const page = selPages.find((p) => p.pageNumber === pn);
      if (page) {
        rowIndex += 1;
        rows.push({
          rowIndex,
          kind: "page",
          pageNumber: page.pageNumber,
          fileName: makeSheetRowFileName(fileName, rowIndex, "page", page.pageNumber),
          label: `Page ${page.pageNumber}`,
          imageUrl: page.imageUrl,
          width: page.width,
          height: page.height,
          note: page.note || ""
        });
      }
    }
    if (includeImages) {
      for (const img of imagesByPage.get(pn) || []) {
        rowIndex += 1;
        const ord = ordinalFromEmbedId(img.id);
        rows.push({
          rowIndex,
          kind: "image",
          pageNumber: img.pageNumber,
          fileName: makeSheetRowFileName(fileName, rowIndex, "image", img.pageNumber, ord),
          label: `P${img.pageNumber} · 抽出画像 #${ord}`,
          imageUrl: img.imageUrl,
          width: img.width,
          height: img.height,
          note: img.note || ""
        });
      }
    }
  }

  return rows;
}

function sheetRowsToTsv(rows) {
  const header = ["row", "label", "kind", "page", "width", "height", "fileName", "note"];
  const lines = [header.join("\t")];
  for (const r of rows) {
    lines.push(
      [
        r.rowIndex,
        escapeTsvField(r.label),
        r.kind,
        r.pageNumber,
        r.width,
        r.height,
        escapeTsvField(r.fileName),
        escapeTsvField(r.note)
      ].join("\t")
    );
  }
  return lines.join("\n");
}

function buildSheetPrepManifest(file, sheetRows) {
  return {
    exportKind: "google-sheets-prep",
    sourcePdf: file.name,
    sourcePdfSize: file.size,
    exportedAt: new Date().toISOString(),
    rowOrdering:
      "ページ番号の昇順。各ページではページPNGの次に、そのページの抽出画像を並べます。",
    rows: sheetRows.map((r) => ({
      row: r.rowIndex,
      label: r.label,
      kind: r.kind,
      pageNumber: r.pageNumber,
      width: r.width,
      height: r.height,
      imageFileName: r.fileName,
      note: r.note
    })),
    googleSheetsPasteHintsJa: [
      "ZIPを解凍し、ファイル名の sheet_001, sheet_002 … の順がこの画面の並びと対応します。",
      "セルを選択し、メニュー「挿入」→「画像」→「セルに画像を挿入」から PNG を指定します。",
      "メタデータを貼りたい場合は「TSVコピー」した列をシートに貼り付け、画像は隣の列に配置すると対応が取りやすくなります。"
    ]
  };
}

const IMAGE_EXTRACT = {
  xobject: { minShort: 40, minArea: 8000, maxAspect: 12 },
  inline: { minShort: 56, minArea: 14000, maxAspect: 10 }
};

function isExtractableImageData(obj) {
  if (!obj || typeof obj.width !== "number" || typeof obj.height !== "number") return false;
  if (obj.width <= 0 || obj.height <= 0) return false;
  if (obj.bitmap) return true;
  const d = obj.data;
  if (!d) return false;
  const len = typeof d.length === "number" ? d.length : d.byteLength ?? 0;
  return len > 0;
}

function passesImageGeometry(imgDict, profileKey) {
  const cfg = IMAGE_EXTRACT[profileKey];
  const w = imgDict.width;
  const h = imgDict.height;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  if (shortSide < cfg.minShort) return false;
  if (w * h < cfg.minArea) return false;
  if (longSide / Math.max(shortSide, 1) > cfg.maxAspect) return false;
  if (shortSide <= 16 && longSide >= 64) return false;
  return true;
}

function passesImageKindGate(imgDict) {
  const ImageKind = pdfjsLib.ImageKind;
  if (!ImageKind || imgDict.kind == null) return true;
  const shortSide = Math.min(imgDict.width, imgDict.height);
  const area = imgDict.width * imgDict.height;
  if (imgDict.kind === ImageKind.GRAYSCALE_1BPP) {
    if (shortSide < 80 || area < 40000) return false;
  }
  return true;
}

function countDistinctRgbBuckets(canvas, step, earlyStopAt) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, w, h);
  const bins = new Set();
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 4;
      bins.add(`${data[i] >> 3}_${data[i + 1] >> 3}_${data[i + 2] >> 3}`);
      if (bins.size > earlyStopAt) return earlyStopAt + 1;
    }
  }
  return bins.size;
}

function isLikelyDecoration(canvas, w, h) {
  const area = w * h;
  const shortSide = Math.min(w, h);
  if (shortSide >= 160 || area >= 160000) return false;
  const step = Math.max(3, Math.floor(shortSide / 20));
  const distinct = countDistinctRgbBuckets(canvas, step, 6);
  return distinct <= 2 && area < 90000;
}

function renderRasterCanvas(imgData) {
  try {
    const w = imgData.width;
    const h = imgData.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true });

    if (imgData.bitmap) {
      ctx.drawImage(imgData.bitmap, 0, 0);
    } else if (imgData.data) {
      const d = imgData.data;
      const raw =
        d instanceof Uint8ClampedArray
          ? d
          : new Uint8ClampedArray(d.buffer ?? d, d.byteOffset ?? 0, d.byteLength ?? d.length);
      ctx.putImageData(new ImageData(raw, w, h), 0, 0);
    } else {
      return null;
    }

    return canvas;
  } catch (err) {
    console.warn("renderRasterCanvas failed", err);
    return null;
  }
}

async function getResolvedPoolObject(page, objId) {
  const pool = typeof objId === "string" && objId.startsWith("g_") ? page.commonObjs : page.objs;
  try {
    return pool.get(objId);
  } catch {
    return new Promise((resolve) => {
      pool.get(objId, (data) => resolve(data));
    });
  }
}

async function extractEmbeddedImagesFromPage(page, options = {}) {
  const { imageType = "image/png", imageQuality = 0.92 } = options;
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;
  const seenXObject = new Set();
  const seenPixelSig = new Set();
  const items = [];

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintImageXObjectRepeat) {
      const objId = args[0];
      if (typeof objId !== "string" || seenXObject.has(objId)) continue;
      seenXObject.add(objId);

      const imgDict = await getResolvedPoolObject(page, objId);
      if (!isExtractableImageData(imgDict)) continue;
      if (!passesImageKindGate(imgDict)) continue;
      if (!passesImageGeometry(imgDict, "xobject")) continue;

      const canvas = renderRasterCanvas(imgDict);
      if (!canvas) continue;
      if (isLikelyDecoration(canvas, imgDict.width, imgDict.height)) continue;

      const imageUrl = canvas.toDataURL(imageType, imageQuality);
      if (!imageUrl) continue;

      items.push({
        source: "xobject",
        width: imgDict.width,
        height: imgDict.height,
        imageUrl,
        imageType
      });
    } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
      const imgDict = args[0];
      if (!isExtractableImageData(imgDict)) continue;
      if (!passesImageKindGate(imgDict)) continue;
      if (!passesImageGeometry(imgDict, "inline")) continue;

      const sig = `${imgDict.width}x${imgDict.height}:${imgDict.data?.length ?? "bmp"}`;
      if (seenPixelSig.has(sig)) continue;
      seenPixelSig.add(sig);

      const canvas = renderRasterCanvas(imgDict);
      if (!canvas) continue;
      if (isLikelyDecoration(canvas, imgDict.width, imgDict.height)) continue;

      const imageUrl = canvas.toDataURL(imageType, imageQuality);
      if (!imageUrl) continue;

      items.push({
        source: "inline",
        width: imgDict.width,
        height: imgDict.height,
        imageUrl,
        imageType
      });
    }
  }

  return items;
}

async function processPdfDocument(file, options = {}) {
  const {
    scale = 1.8,
    imageType = "image/png",
    imageQuality = 0.92,
    onProgress
  } = options;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  const embeddedImages = [];
  let embedSeq = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);

    const extracted = await extractEmbeddedImagesFromPage(page, { imageType, imageQuality });
    for (const row of extracted) {
      embedSeq += 1;
      embeddedImages.push({
        ...row,
        id: `embed-${embedSeq}`,
        pageNumber,
        selected: true,
        note: ""
      });
    }

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    pages.push({
      id: `page-${pageNumber}`,
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      imageUrl: canvas.toDataURL(imageType, imageQuality),
      imageType,
      selected: true,
      note: ""
    });

    page.cleanup();

    onProgress?.({
      current: pageNumber,
      total: pdf.numPages,
      percent: Math.round((pageNumber / pdf.numPages) * 100)
    });
  }

  return {
    pageCount: pdf.numPages,
    pages,
    embeddedImages
  };
}

function EmptyState({ onFile }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("PDFファイルを選択してください。");
      return;
    }

    onFile(file);
  };

  return (
    <section
      className={`uploadHero ${isDragging ? "dragging" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => handleFiles(event.target.files)}
      />

      <div className="heroCard">
        <div className="heroIcon">
          <Upload size={30} />
        </div>
        <h1>PDF論文をアップロード</h1>
        <p>
          PDFをページPNGに分割し、埋め込みラスタ画像も抽出します。採用した画像だけをレビュー・書き出しできます。
        </p>
        <button type="button" className="primaryButton">PDFを選択</button>
      </div>
    </section>
  );
}

function PageRow({ page, active, onSelect, onToggle }) {
  return (
    <button
      type="button"
      className={`candidateRow ${active ? "active" : ""}`}
      onClick={() => onSelect(page.id)}
    >
      <div className="typeIcon page">
        <ImageIcon size={16} />
      </div>

      <div className="rowThumb">
        <img src={page.imageUrl} alt={`Page ${page.pageNumber}`} />
      </div>

      <div className="rowMain">
        <div className="rowTitle">
          <strong>Page {page.pageNumber}</strong>
          <span>{page.width} × {page.height}px</span>
        </div>
        <p>PDFページをPNG画像としてレンダリング済み。</p>
      </div>

      <div className="rowAside">
        <span className={`pill ${page.selected ? "ok" : "muted"}`}>
          {page.selected ? <Check size={13} /> : <X size={13} />}
          {page.selected ? "採用" : "除外"}
        </span>
      </div>

      <span
        className="rowToggle"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(page.id);
        }}
      >
        {page.selected ? "除外" : "採用"}
      </span>
    </button>
  );
}

function EmbeddedImageRow({ item, active, onSelect, onToggle }) {
  return (
    <button
      type="button"
      className={`candidateRow ${active ? "active" : ""}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="typeIcon embedded">
        <Images size={16} />
      </div>

      <div className="rowThumb">
        <img src={item.imageUrl} alt={`Extracted page ${item.pageNumber}`} />
      </div>

      <div className="rowMain">
        <div className="rowTitle">
          <strong>Page {item.pageNumber}</strong>
          <span>{item.width} × {item.height}px</span>
        </div>
        <p>PDF内の埋め込みラスタ画像（図表向けにフィルタ済み）。</p>
      </div>

      <div className="rowAside">
        <span className={`pill ${item.selected ? "ok" : "muted"}`}>
          {item.selected ? <Check size={13} /> : <X size={13} />}
          {item.selected ? "採用" : "除外"}
        </span>
      </div>

      <span
        className="rowToggle"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(item.id);
        }}
      >
        {item.selected ? "除外" : "採用"}
      </span>
    </button>
  );
}

function Reviewer({ file, pages, setPages, embeddedImages, setEmbeddedImages, onReset }) {
  const [listTab, setListTab] = useState("pages");
  const [activePageId, setActivePageId] = useState(pages[0]?.id);
  const [activeImageId, setActiveImageId] = useState(embeddedImages[0]?.id);
  const [query, setQuery] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState("review");
  const [sheetIncludePages, setSheetIncludePages] = useState(true);
  const [sheetIncludeImages, setSheetIncludeImages] = useState(true);
  const [sheetZipBusy, setSheetZipBusy] = useState(false);
  const [prepNotice, setPrepNotice] = useState("");
  const prepNoticeTimerRef = useRef(null);

  const activePage = pages.find((page) => page.id === activePageId) || pages[0];
  const activeImage =
    embeddedImages.find((item) => item.id === activeImageId) || embeddedImages[0];

  const selectedPages = useMemo(
    () => pages.filter((page) => page.selected),
    [pages]
  );

  const selectedImages = useMemo(
    () => embeddedImages.filter((item) => item.selected),
    [embeddedImages]
  );

  const sheetRows = useMemo(
    () =>
      buildSheetExportRows(file.name, pages, embeddedImages, {
        includePages: sheetIncludePages,
        includeImages: sheetIncludeImages
      }),
    [file.name, pages, embeddedImages, sheetIncludePages, sheetIncludeImages]
  );

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages;

    return pages.filter((page) => {
      return (
        `page ${page.pageNumber}`.includes(normalized) ||
        page.note.toLowerCase().includes(normalized)
      );
    });
  }, [pages, query]);

  const filteredImages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return embeddedImages;

    return embeddedImages.filter((item) => {
      return (
        `page ${item.pageNumber}`.includes(normalized) ||
        item.note.toLowerCase().includes(normalized)
      );
    });
  }, [embeddedImages, query]);

  const togglePage = (id) => {
    setPages((current) =>
      current.map((page) =>
        page.id === id ? { ...page, selected: !page.selected } : page
      )
    );
  };

  const updatePage = (id, patch) => {
    setPages((current) =>
      current.map((page) =>
        page.id === id ? { ...page, ...patch } : page
      )
    );
  };

  const toggleImage = (id) => {
    setEmbeddedImages((current) =>
      current.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const updateImage = (id, patch) => {
    setEmbeddedImages((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    );
  };

  const downloadPage = (page) => {
    const anchor = document.createElement("a");
    anchor.href = page.imageUrl;
    anchor.download = makeDownloadName(file.name, page.pageNumber);
    anchor.click();
  };

  const downloadImage = (item) => {
    const anchor = document.createElement("a");
    anchor.href = item.imageUrl;
    anchor.download = makeEmbeddedDownloadName(
      file.name,
      item.pageNumber,
      ordinalFromEmbedId(item.id)
    );
    anchor.click();
  };

  const downloadSelectedManifest = () => {
    const manifest = {
      fileName: file.name,
      fileSize: file.size,
      exportedAt: new Date().toISOString(),
      totalPages: pages.length,
      extractedImageCount: embeddedImages.length,
      selectedPages: selectedPages.map((page) => ({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        imageFileName: makeDownloadName(file.name, page.pageNumber),
        note: page.note
      })),
      selectedExtractedImages: selectedImages.map((item) => ({
        pageNumber: item.pageNumber,
        width: item.width,
        height: item.height,
        imageFileName: makeEmbeddedDownloadName(
          file.name,
          item.pageNumber,
          ordinalFromEmbedId(item.id)
        ),
        note: item.note
      }))
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file.name.replace(/\.pdf$/i, "")}-page-images-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllSelectedPages = async () => {
    for (const page of selectedPages) {
      downloadPage(page);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const downloadAllSelectedExtracted = async () => {
    for (const item of selectedImages) {
      downloadImage(item);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const panelTitle = listTab === "pages" ? "ページ画像一覧" : "抽出画像一覧";
  const panelSubtitle =
    listTab === "pages"
      ? "各ページをレンダリングしたPNGです。"
      : "PDFに埋め込まれたラスタ画像です。ベクターだけの図は含まれません。";

  const flashPrepNotice = (message) => {
    if (prepNoticeTimerRef.current) window.clearTimeout(prepNoticeTimerRef.current);
    setPrepNotice(message);
    prepNoticeTimerRef.current = window.setTimeout(() => {
      setPrepNotice("");
      prepNoticeTimerRef.current = null;
    }, 4200);
  };

  const downloadSheetZipBundle = async () => {
    if (sheetRows.length === 0) return;
    setSheetZipBusy(true);
    try {
      const zip = new JSZip();
      for (const row of sheetRows) {
        zip.file(row.fileName, dataUrlToBlob(row.imageUrl));
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.pdf$/i, "")}-sheets-prep.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      flashPrepNotice("ZIPをダウンロードしました。");
    } catch (err) {
      console.error(err);
      flashPrepNotice("ZIPの作成に失敗しました。");
    } finally {
      setSheetZipBusy(false);
    }
  };

  const downloadSheetPrepManifestJson = () => {
    const manifest = buildSheetPrepManifest(file, sheetRows);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file.name.replace(/\.pdf$/i, "")}-sheets-prep-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    flashPrepNotice("Sheets用 manifest をダウンロードしました。");
  };

  const copySheetPrepTsv = async () => {
    if (sheetRows.length === 0) return;
    try {
      await navigator.clipboard.writeText(sheetRowsToTsv(sheetRows));
      flashPrepNotice("TSVをクリップボードにコピーしました。");
    } catch (err) {
      console.error(err);
      flashPrepNotice("クリップボードへのコピーに失敗しました。");
    }
  };

  return (
    <div className="workspace">
      <aside className="navPanel">
        <div className="brand">
          <div className="brandMark"><Sparkles size={20} /></div>
          <div>
            <strong>Paper Extractor</strong>
            <span>PDF Image Splitter</span>
          </div>
        </div>

        <nav>
          <button
            type="button"
            className={`navItem ${workspaceMode === "review" ? "active" : ""}`}
            onClick={() => setWorkspaceMode("review")}
          >
            1. ページ画像分割
          </button>
          <button type="button" className="navItem" disabled>
            2. 図表候補検出
          </button>
          <button type="button" className="navItem" disabled>
            3. 図表レビュー
          </button>
          <button
            type="button"
            className={`navItem ${workspaceMode === "sheetsPrep" ? "active" : ""}`}
            onClick={() => setWorkspaceMode("sheetsPrep")}
          >
            4. Sheets準備
          </button>
        </nav>

        <div className="sideInfo">
          <strong>{workspaceMode === "review" ? "実装済み" : "Sheets準備"}</strong>
          <p>
            {workspaceMode === "review"
              ? "ページPNGの分割に加え、埋め込みラスタ画像を抽出します。ベクター図のみの論文では抽出画像は空になります。"
              : "採用したページPNG・抽出画像を並べ、ZIP・manifest・TSVでスプレッドシートへ貼る直前まで進めます。"}
          </p>
        </div>
      </aside>

      <main className="mainPanel">
        {prepNotice ? (
          <div className="prepNoticeBar" role="status">
            {prepNotice}
          </div>
        ) : null}

        <header className="topbar">
          <div className="fileSummary">
            <div className="fileIcon"><FileText size={22} /></div>
            <div>
              <h1>{file.name}</h1>
              <p>
                {formatBytes(file.size)} / {pages.length}ページ / 抽出 {embeddedImages.length}枚 /
                採用ページ {selectedPages.length} / 採用抽出 {selectedImages.length}
                {workspaceMode === "sheetsPrep" ? ` · Sheets ${sheetRows.length}行` : ""}
              </p>
            </div>
          </div>

          <div className="topActions">
            <button type="button" className="ghostButton" onClick={onReset}>
              <RotateCcw size={16} />
              別PDF
            </button>
            <button type="button" className="ghostButton" onClick={downloadSelectedManifest}>
              <Download size={16} />
              manifest
            </button>
            {workspaceMode === "review" ? (
              <>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={downloadAllSelectedExtracted}
                  disabled={embeddedImages.length === 0 || selectedImages.length === 0}
                >
                  <Download size={16} />
                  抽出PNG
                </button>
                <button type="button" className="primaryButton" onClick={downloadAllSelectedPages}>
                  <Download size={16} />
                  ページPNG
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={downloadSheetPrepManifestJson}
                  disabled={sheetRows.length === 0}
                >
                  <Download size={16} />
                  Sheets manifest
                </button>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={copySheetPrepTsv}
                  disabled={sheetRows.length === 0}
                >
                  <ClipboardCopy size={16} />
                  TSVコピー
                </button>
                <button
                  type="button"
                  className="primaryButton"
                  onClick={downloadSheetZipBundle}
                  disabled={sheetRows.length === 0 || sheetZipBusy}
                >
                  <Download size={16} />
                  {sheetZipBusy ? "ZIP作成中…" : "ZIP一括"}
                </button>
              </>
            )}
          </div>
        </header>

        {workspaceMode === "review" ? (
          <>
            <section className="dashboard">
              <div className="statCard">
                <span>Total Pages</span>
                <strong>{pages.length}</strong>
              </div>
              <div className="statCard">
                <span>Selected</span>
                <strong>{selectedPages.length}</strong>
              </div>
              <div className="statCard">
                <span>Extracted</span>
                <strong>{embeddedImages.length}</strong>
              </div>
              <div className="statCard">
                <span>Scale</span>
                <strong>1.8x</strong>
              </div>
            </section>

            <section className="contentGrid">
              <section className="candidatePanel card">
                <div className="panelHeader">
                  <div>
                    <h2>{panelTitle}</h2>
                    <p>{panelSubtitle}</p>
                  </div>
                  {listTab === "pages" ? <Layers size={18} /> : <Images size={18} />}
                </div>

                <div className="viewTabs">
                  <button
                    type="button"
                    className={listTab === "pages" ? "active" : ""}
                    onClick={() => setListTab("pages")}
                  >
                    ページ（{pages.length}）
                  </button>
                  <button
                    type="button"
                    className={listTab === "images" ? "active" : ""}
                    onClick={() => setListTab("images")}
                  >
                    抽出（{embeddedImages.length}）
                  </button>
                </div>

                <div className="filters">
                  <div className="searchBox">
                    <Search size={16} />
                    <input
                      value={query}
                      placeholder="例: page 3 / コメント検索"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                </div>

                <div className="candidateList">
                  {listTab === "pages" &&
                    filteredPages.map((page) => (
                      <PageRow
                        key={page.id}
                        page={page}
                        active={page.id === activePage?.id}
                        onSelect={setActivePageId}
                        onToggle={togglePage}
                      />
                    ))}

                  {listTab === "images" && embeddedImages.length === 0 && (
                    <div className="emptyListHint">
                      埋め込みラスタがありません。図がベクター形式の論文では「ページ」タブのPNGをご利用ください。
                    </div>
                  )}

                  {listTab === "images" &&
                    filteredImages.map((item) => (
                      <EmbeddedImageRow
                        key={item.id}
                        item={item}
                        active={item.id === activeImage?.id}
                        onSelect={setActiveImageId}
                        onToggle={toggleImage}
                      />
                    ))}
                </div>
              </section>

              <section className="reviewPanel card">
                {listTab === "pages" && activePage && (
                  <>
                    <div className="reviewHeader">
                      <div>
                        <span className="typeBadge page">
                          <ImageIcon size={16} />
                          Page image
                        </span>
                        <h2>Page {activePage.pageNumber}</h2>
                        <p>{activePage.width} × {activePage.height}px / PNG</p>
                      </div>

                      <div className="reviewActions">
                        <button
                          type="button"
                          className={`selectButton ${activePage.selected ? "selected" : ""}`}
                          onClick={() => togglePage(activePage.id)}
                        >
                          {activePage.selected ? <Check size={16} /> : <X size={16} />}
                          {activePage.selected ? "採用中" : "除外中"}
                        </button>
                        <button type="button" className="ghostButton" onClick={() => downloadPage(activePage)}>
                          <Download size={16} />
                          この画像
                        </button>
                      </div>
                    </div>

                    <div className="previewBox">
                      <img src={activePage.imageUrl} alt={`Page ${activePage.pageNumber}`} />
                    </div>

                    <div className="editorGrid">
                      <div>
                        <label>ページ番号</label>
                        <input value={`Page ${activePage.pageNumber}`} readOnly />
                      </div>
                      <div>
                        <label>画像サイズ</label>
                        <input value={`${activePage.width} × ${activePage.height}px`} readOnly />
                      </div>
                      <div className="wide">
                        <label>レビューコメント</label>
                        <textarea
                          value={activePage.note}
                          placeholder="例: このページにFigure 2とTable 1がある"
                          onChange={(event) => updatePage(activePage.id, { note: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className="sheetPreview">
                      <div className="sheetHeader">
                        <div>
                          <strong>次ステップ</strong>
                          <span>サイドバーの「Sheets準備」で採用ページを並べて書き出します。</span>
                        </div>
                        <ZoomIn size={18} />
                      </div>
                      <div className="nextStep">
                        <div>
                          <b>Review</b>
                          <span>ページごとの採用・除外</span>
                        </div>
                        <div>
                          <b>Sheets準備</b>
                          <span>ZIP / manifest / TSV</span>
                        </div>
                        <div>
                          <b>Sheets</b>
                          <span>セルへ画像を貼り付け</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {listTab === "images" && embeddedImages.length > 0 && activeImage && (
                  <>
                    <div className="reviewHeader">
                      <div>
                        <span className="typeBadge embedded">
                          <Images size={16} />
                          Extracted image
                        </span>
                        <h2>Page {activeImage.pageNumber}</h2>
                        <p>{activeImage.width} × {activeImage.height}px / PNG</p>
                      </div>

                      <div className="reviewActions">
                        <button
                          type="button"
                          className={`selectButton ${activeImage.selected ? "selected" : ""}`}
                          onClick={() => toggleImage(activeImage.id)}
                        >
                          {activeImage.selected ? <Check size={16} /> : <X size={16} />}
                          {activeImage.selected ? "採用中" : "除外中"}
                        </button>
                        <button type="button" className="ghostButton" onClick={() => downloadImage(activeImage)}>
                          <Download size={16} />
                          この画像
                        </button>
                      </div>
                    </div>

                    <div className="previewBox previewBoxEmbed">
                      <img src={activeImage.imageUrl} alt={`Extracted page ${activeImage.pageNumber}`} />
                    </div>

                    <div className="editorGrid">
                      <div className="wide">
                        <label>レビューコメント</label>
                        <textarea
                          value={activeImage.note}
                          placeholder="例: Figure 2 のソース画像"
                          onChange={(event) => updateImage(activeImage.id, { note: event.target.value })}
                        />
                      </div>
                    </div>
                  </>
                )}

                {listTab === "images" && embeddedImages.length === 0 && (
                  <div className="reviewEmpty">
                    <Images size={36} />
                    <h2>抽出画像がありません</h2>
                    <p>ベクター図のみのPDFでは埋め込みラスタが無いことがあります。ページタブのPNGをご利用ください。</p>
                  </div>
                )}
              </section>
            </section>
          </>
        ) : (
          <section className="sheetsPrep card">
            <div className="sheetsPrepHeader">
              <div className="panelHeader sheetsPrepPanelTitle">
                <div>
                  <h2>スプレッドシート貼り付けの直前まで</h2>
                  <p>採用したページPNG・抽出画像をページ番号順に並べます。</p>
                </div>
                <Table size={20} />
              </div>

              <div className="sheetsPrepToolbar">
                <label className="toggleRow">
                  <input
                    type="checkbox"
                    checked={sheetIncludePages}
                    onChange={(event) => setSheetIncludePages(event.target.checked)}
                  />
                  ページPNG
                </label>
                <label className="toggleRow">
                  <input
                    type="checkbox"
                    checked={sheetIncludeImages}
                    onChange={(event) => setSheetIncludeImages(event.target.checked)}
                  />
                  抽出PNG
                </label>
                <span className="sheetsPrepDivider" aria-hidden />
                <button
                  type="button"
                  className="primaryButton"
                  onClick={downloadSheetZipBundle}
                  disabled={sheetRows.length === 0 || sheetZipBusy}
                >
                  <Download size={16} />
                  {sheetZipBusy ? "ZIP作成中…" : "ZIP一括"}
                </button>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={downloadSheetPrepManifestJson}
                  disabled={sheetRows.length === 0}
                >
                  <Download size={16} />
                  Sheets manifest
                </button>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={copySheetPrepTsv}
                  disabled={sheetRows.length === 0}
                >
                  <ClipboardCopy size={16} />
                  TSVコピー
                </button>
              </div>
            </div>

            {sheetRows.length === 0 ? (
              <div className="sheetsPrepEmpty">
                <LayoutGrid size={40} />
                <h3>並べる項目がありません</h3>
                <p>レビューで採用するページまたは抽出画像を増やしてから、再度お試しください。</p>
                <button type="button" className="primaryButton" onClick={() => setWorkspaceMode("review")}>
                  レビューに戻る
                </button>
              </div>
            ) : (
              <>
                <div className="sheetGalleryGrid">
                  {sheetRows.map((row) => (
                    <figure key={row.fileName} className="sheetGalleryCard">
                      <div className="sheetGalleryBadge">{row.rowIndex}</div>
                      <div className={`sheetGalleryThumb ${row.kind === "page" ? "isPage" : "isEmbed"}`}>
                        <img src={row.imageUrl} alt="" />
                      </div>
                      <figcaption>
                        <strong>{row.label}</strong>
                        <span className="sheetGalleryFile">{row.fileName}</span>
                        <span className="sheetGalleryMeta">{row.width} × {row.height}px</span>
                        {row.note ? <span className="sheetGalleryNote">{row.note}</span> : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                <div className="sheetsInstrBox">
                  <h3>Google スプレッドシートでの貼り付け（手動）</h3>
                  <ol>
                    <li><strong>ZIP一括</strong>をダウンロードして解凍します。</li>
                    <li>シート上でセルを選択し、<strong>挿入 → 画像 → セルに画像を挿入</strong>から PNG を選びます。</li>
                    <li>ファイル名の <code>sheet_001</code>、<code>sheet_002</code> … の順が、この画面の並びと対応します。</li>
                  </ol>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function App() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [embeddedImages, setEmbeddedImages] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);

  const handleFile = async (nextFile) => {
    setFile(nextFile);
    setPages([]);
    setEmbeddedImages([]);
    setError("");
    setProgress({ current: 0, total: 0, percent: 0 });
    setStatus("loading");

    try {
      const result = await processPdfDocument(nextFile, {
        scale: 1.8,
        imageType: "image/png",
        onProgress: setProgress
      });

      setPages(result.pages);
      setEmbeddedImages(result.embeddedImages);
      setStatus("ready");
    } catch (err) {
      console.error(err);
      setError("PDFの読み込み、または画像分割に失敗しました。別のPDFで試してください。");
      setStatus("error");
    }
  };

  const reset = () => {
    setFile(null);
    setPages([]);
    setEmbeddedImages([]);
    setError("");
    setProgress(null);
    setStatus("idle");
  };

  return (
    <div className="app">
      {status === "idle" && <EmptyState onFile={handleFile} />}

      {status === "loading" && (
        <section className="loadingScreen">
          <div className="spinner" />
          <h2>PDFを処理しています</h2>
          <p>
            {progress?.total
              ? `${progress.current} / ${progress.total}ページ（分割・画像抽出 ${progress.percent}%）`
              : "PDFを読み込んでいます。"}
          </p>
          <div className="progressBar">
            <div style={{ width: `${progress?.percent || 4}%` }} />
          </div>
        </section>
      )}

      {status === "error" && (
        <section className="loadingScreen">
          <h2>読み込みエラー</h2>
          <p>{error}</p>
          <button type="button" className="primaryButton" onClick={reset}>やり直す</button>
        </section>
      )}

      {status === "ready" && file && (
        <Reviewer
          key={`${file.name}-${file.size}`}
          file={file}
          pages={pages}
          setPages={setPages}
          embeddedImages={embeddedImages}
          setEmbeddedImages={setEmbeddedImages}
          onReset={reset}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
