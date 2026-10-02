// Reads PDFs with Mozilla's PDF.js: text pages are read directly; pages that
// are only images (scans) are rendered so they can be OCR'd.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Line, Span } from '../structure/types';
import { assetUrl } from '../util/assets';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjs.getDocument({
    data,
    cMapUrl: assetUrl('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('vendor/pdfjs/standard_fonts/'),
    wasmUrl: assetUrl('vendor/pdfjs/wasm/'),
    iccUrl: assetUrl('vendor/pdfjs/iccs/'),
  }).promise;
}

export async function pdfInfo(doc: PdfDoc): Promise<{ title?: string; author?: string; labels: (string | undefined)[] }> {
  const labels: (string | undefined)[] = Array.from({ length: doc.numPages }, () => undefined);
  try {
    const l = await doc.getPageLabels();
    if (l) l.forEach((v, i) => (labels[i] = v || undefined));
  } catch {
    /* no labels */
  }
  let title: string | undefined;
  let author: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown>;
    title = cleanTitle(typeof info.Title === 'string' ? info.Title : undefined);
    author = typeof info.Author === 'string' && info.Author.trim().length > 1 ? info.Author.trim() : undefined;
  } catch {
    /* no metadata */
  }
  return { title, author, labels };
}

function cleanTitle(t?: string): string | undefined {
  if (!t) return undefined;
  const s = t.replace(/^Microsoft (Word|PowerPoint) - /i, '').replace(/\.(docx?|pdf|pptx?)$/i, '').trim();
  if (s.length < 3 || /^untitled/i.test(s) || /^[\w-]+\.(tmp|indd|qxd)$/i.test(s)) return undefined;
  return s;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface PdfTextPage {
  width: number;
  height: number;
  lines: Line[];
  chars: number;
  hasImages: boolean;
}

/** Extracts positioned lines from a page's text layer. */
export async function readTextPage(page: PdfPage): Promise<PdfTextPage> {
  const viewport = page.getViewport({ scale: 1 });
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const OPS = pdfjs.OPS;
  const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  let hasImages = false;
  let pathOps = 0;
  for (const fn of ops.fnArray) {
    if (imageOps.has(fn)) hasImages = true;
    if (fn === OPS.constructPath) pathOps++;
  }
  if (pathOps > 150) hasImages = true; // vector charts and diagrams

  const fontStyle = new Map<string, { b: boolean; i: boolean }>();
  const styleOf = (fontName: string) => {
    if (!fontStyle.has(fontName)) {
      let name = '';
      try {
        if (page.commonObjs.has(fontName)) name = String((page.commonObjs.get(fontName) as { name?: string })?.name ?? '');
      } catch {
        /* font not loaded */
      }
      fontStyle.set(fontName, { b: /bold|black|heavy|semibold|demi/i.test(name), i: /italic|oblique/i.test(name) });
    }
    return fontStyle.get(fontName)!;
  };

  type Pos = { str: string; x: number; y: number; w: number; size: number; b: boolean; i: boolean };
  const items: Pos[] = [];
  let chars = 0;
  for (const raw of content.items as unknown[]) {
    const it = raw as TextItem;
    if (typeof it.str !== 'string' || !it.str) continue;
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]) || it.height || 10;
    const st = styleOf(it.fontName);
    items.push({ str: it.str, x: tx[4], y: tx[5], w: it.width, size, ...st });
    chars += it.str.trim().length;
  }

  // Group items into lines by baseline; a big horizontal gap starts a new line
  // (this keeps two columns apart).
  // 1) cluster by baseline (superscripts sit a little higher but join their line),
  // 2) split each cluster where there is a wide horizontal gap (columns).
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters: { ref: Pos; items: Pos[] }[] = [];
  for (const it of items) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(it.y - c.ref.y) <= 0.55 * Math.max(it.size, c.ref.size)) {
      c.items.push(it);
      if (it.size > c.ref.size || (it.size === c.ref.size && it.y > c.ref.y)) c.ref = it;
    } else {
      clusters.push({ ref: it, items: [it] });
    }
  }
  const groups: Pos[][] = [];
  for (const c of clusters) {
    c.items.sort((a, b) => a.x - b.x);
    let cur: Pos[] = [];
    for (const it of c.items) {
      const last = cur[cur.length - 1];
      if (last && it.x - (last.x + last.w) > 1.6 * Math.max(it.size, last.size)) {
        groups.push(cur);
        cur = [];
      }
      cur.push(it);
    }
    if (cur.length) groups.push(cur);
  }

  const lines: Line[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    // Dominant size by characters.
    const bySize = new Map<number, number>();
    for (const it of g) bySize.set(Math.round(it.size * 2) / 2, (bySize.get(Math.round(it.size * 2) / 2) ?? 0) + it.str.length);
    const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const baseline = g.filter((it) => Math.abs(it.size - size) < 0.6)[0]?.y ?? g[0].y;
    const spans: Span[] = [];
    let prevEnd: number | undefined;
    for (const it of g) {
      const sup = it.size < size * 0.8 && baseline - it.y > size * 0.15 && it.str.trim().length <= 3;
      let text = it.str;
      if (prevEnd !== undefined) {
        const gap = it.x - prevEnd;
        const prevText = spans[spans.length - 1]?.text ?? '';
        if (gap > size * 0.15 && !/\s$/.test(prevText) && !/^\s/.test(text) && !sup) text = ' ' + text;
      }
      const last = spans[spans.length - 1];
      if (last && !!last.sup === sup && !!last.b === it.b && !!last.i === it.i) last.text += text;
      else spans.push({ text, ...(sup ? { sup: true } : {}), ...(it.b ? { b: true } : {}), ...(it.i ? { i: true } : {}) });
      prevEnd = it.x + it.w;
    }
    const x0 = Math.min(...g.map((it) => it.x));
    const x1 = Math.max(...g.map((it) => it.x + it.w));
    lines.push({ spans, x0, x1, y0: baseline - size * 0.8, y1: baseline + size * 0.2, size });
  }

  return { width: viewport.width, height: viewport.height, lines, chars, hasImages };
}

/** Renders a page to a canvas at roughly `dpi` dots per inch. */
export async function renderPage(page: PdfPage, dpi: number, maxEdge = 3600): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  const edge = Math.max(base.width, base.height) * scale;
  if (edge > maxEdge) scale *= maxEdge / edge;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return canvas;
}
