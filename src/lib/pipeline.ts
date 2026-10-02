// Turns the files of one reading into structured content: decides per page
// whether to read the text layer or OCR it, finds figures, and rebuilds
// paragraphs, headings, footnotes and page numbers.
import type { Block, BundleSettings, Note, PageInfo, StoredImage } from './model';
import { buildStructure } from './structure';
import type { FigureRegion, Line, PageLayout } from './structure/types';
import { openPdf, pdfInfo, readTextPage, renderPage, type PdfDoc } from './ingest/pdf';
import { cropCanvas, encodeJpeg, grayData, loadImage, rotateCanvas, splitSpread, type Raster } from './ingest/image';
import { readDocx } from './ingest/docx';
import { prepareForOcr } from './ocr/preprocess';
import { detectFigures, inside, type Box } from './ocr/figures';
import { ocr, poolSize } from './ocr/engine';

export type SourceKind = 'pdf' | 'image' | 'docx';

export function kindOf(file: File): SourceKind | undefined {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?|hei[cf])$/.test(n)) return 'image';
  return undefined;
}

export interface ProcessContext {
  settings: BundleSettings;
  newId: () => string;
  putImage: (id: string, img: StoredImage) => Promise<void>;
  onProgress: (fraction: number, message: string) => void;
  /** Rotate every page by this many quarter turns before OCR (review screen "rotate"). */
  rotate?: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  title?: string;
  author?: string;
  pages: PageInfo[];
  blocks: Block[];
  notes: Note[];
}

/** Runs async tasks with at most `n` in flight. */
async function eachLimited<T>(items: T[], n: number, fn: (item: T, index: number) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

export function titleFromFileName(name: string): string {
  let s = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ');
  // "week5-smith-chapter3" → "Week5 smith chapter3"; "Smith - Chapter 3" → "Smith – Chapter 3"
  s = /\s/.test(s) ? s.replace(/\s+-\s+/g, ' – ') : s.replace(/-+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Untitled reading';
}

const naturalSort = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export async function processSources(files: File[], kind: SourceKind, ctx: ProcessContext): Promise<ProcessResult> {
  if (kind === 'docx') return processDocx(files[0], ctx);
  if (kind === 'pdf') return processPdf(files[0], ctx);
  return processImages([...files].sort(naturalSort), ctx);
}

// --- Word --------------------------------------------------------------------

async function processDocx(file: File, ctx: ProcessContext): Promise<ProcessResult> {
  ctx.onProgress(0.1, 'Reading document');
  const res = await readDocx(await file.arrayBuffer(), ctx.newId);
  for (const img of res.images) await ctx.putImage(img.id, { data: img.data, mime: img.mime, width: img.width, height: img.height });
  ctx.onProgress(1, 'Done');
  return { title: res.title, pages: [{ label: '', source: 'docx' }], blocks: res.blocks, notes: res.notes };
}

// --- PDF ---------------------------------------------------------------------

async function processPdf(file: File, ctx: ProcessContext): Promise<ProcessResult> {
  ctx.onProgress(0, 'Opening PDF');
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const info = await pdfInfo(doc);
    const n = doc.numPages;
    const layouts: PageLayout[] = new Array(n);
    let done = 0;
    let ocrPages = 0;
    const indices = Array.from({ length: n }, (_, i) => i);
    await eachLimited(
      indices,
      poolSize(),
      async (i) => {
        layouts[i] = await processPdfPage(doc, i, info.labels[i], ctx);
        if (layouts[i].source === 'ocr') ocrPages++;
        done++;
        ctx.onProgress(done / n, ocrPages ? `Reading scanned pages (${done}/${n})` : `Reading pages (${done}/${n})`);
      },
      ctx.signal,
    );
    const s = buildStructure(layouts);
    return { title: info.title ?? firstHeading(s.blocks), author: info.author, ...s };
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function processPdfPage(doc: PdfDoc, i: number, pdfLabel: string | undefined, ctx: ProcessContext): Promise<PageLayout> {
  const page = await doc.getPage(i + 1);
  try {
    const tp = await readTextPage(page);
    if (tp.chars >= 40) {
      let figures: FigureRegion[] = [];
      if (tp.hasImages) {
        const canvas = await renderPage(page, 200, 2400);
        const scale = canvas.width / tp.width;
        const { gray, width, height } = grayData(canvas);
        const sizes = tp.lines.map((l) => l.size).sort((a, b) => a - b);
        const lh = (sizes[sizes.length >> 1] ?? 10) * scale;
        const boxes = detectFigures(
          gray,
          width,
          height,
          tp.lines.map((l) => ({ x0: l.x0 * scale, y0: l.y0 * scale, x1: l.x1 * scale, y1: l.y1 * scale })),
          lh,
        );
        figures = await saveFigures(canvas, boxes, 1, ctx);
        figures = figures.map((f) => ({ ...f, x0: f.x0 / scale, y0: f.y0 / scale, x1: f.x1 / scale, y1: f.y1 / scale }));
      }
      return { width: tp.width, height: tp.height, lines: tp.lines, figures, pdfLabel, source: 'text' };
    }
    const canvas = await renderPage(page, 300);
    return await ocrPage(canvas, ctx, pdfLabel, ctx.rotate ?? 0);
  } finally {
    page.cleanup();
  }
}

// --- Photos --------------------------------------------------------------------

async function processImages(files: File[], ctx: ProcessContext): Promise<ProcessResult> {
  ctx.onProgress(0, 'Loading photos');
  // Load (and split spreads) one file at a time to keep memory low.
  const pages: { file: File; part: number; parts: number }[] = [];
  const rasters = new Map<string, Raster>();
  for (const f of files) {
    const r = rotateCanvas(await loadImage(f), ctx.rotate ?? 0);
    const halves = splitSpread(r);
    halves.forEach((h, k) => {
      pages.push({ file: f, part: k, parts: halves.length });
      rasters.set(`${f.name}#${k}`, h);
    });
  }
  const layouts: PageLayout[] = new Array(pages.length);
  let done = 0;
  await eachLimited(
    pages,
    poolSize(),
    async (p, i) => {
      const key = `${p.file.name}#${p.part}`;
      layouts[i] = await ocrPage(rasters.get(key)!, ctx, undefined, 0);
      rasters.delete(key);
      done++;
      ctx.onProgress(done / pages.length, `Reading photos (${done}/${pages.length})`);
    },
    ctx.signal,
  );
  const s = buildStructure(layouts);
  return { title: firstHeading(s.blocks), ...s };
}

// --- OCR one page --------------------------------------------------------------

async function ocrPage(src: Raster, ctx: ProcessContext, pdfLabel: string | undefined, rotate: number): Promise<PageLayout> {
  const rotated = rotateCanvas(src, rotate);
  const prep = prepareForOcr(rotated);
  const res = await ocr(prep.canvas, ctx.settings.ocrLanguage || 'eng');

  const confident = res.lines.filter((l) => (l.conf ?? 0) >= 55);
  const heights = confident.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
  const lh = heights[heights.length >> 1] ?? 30;
  let boxes: Box[] = detectFigures(prep.gray, prep.width, prep.height, confident, lh);
  for (const b of res.imageBlocks) {
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (area > prep.width * prep.height * 0.03 && !boxes.some((x) => overlap(x, b) > 0.5)) boxes.push(b);
  }
  // Garbage "text" that OCR found inside pictures is dropped.
  const lines: Line[] = res.lines.filter((l) => {
    const cx = (l.x0 + l.x1) / 2;
    const cy = (l.y0 + l.y1) / 2;
    return !boxes.some((b) => inside(b, cx, cy) && (l.conf ?? 0) < 75);
  });
  boxes = boxes.filter((b) => lines.filter((l) => inside(b, (l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2)).length < 6);

  // Crop figures from the original (colour) image.
  const s = 1 / prep.scale;
  const figures = (await saveFigures(rotated, boxes.map((b) => ({ x0: b.x0 * s, y0: b.y0 * s, x1: b.x1 * s, y1: b.y1 * s })), 1, ctx)).map(
    (f) => ({ ...f, x0: f.x0 * prep.scale, y0: f.y0 * prep.scale, x1: f.x1 * prep.scale, y1: f.y1 * prep.scale }),
  );

  const previewId = ctx.newId();
  const pv = await encodeJpeg(rotated, 1100, 0.72);
  await ctx.putImage(previewId, { data: pv.data, mime: 'image/jpeg', width: pv.width, height: pv.height });

  return {
    width: prep.width,
    height: prep.height,
    lines,
    figures,
    pdfLabel,
    source: 'ocr',
    confidence: res.confidence,
    preview: previewId,
  };
}

function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return area > 0 ? (w * h) / area : 0;
}

async function saveFigures(src: Raster, boxes: Box[], scale: number, ctx: ProcessContext): Promise<FigureRegion[]> {
  const out: FigureRegion[] = [];
  for (const b of boxes) {
    const crop = cropCanvas(src, b.x0 * scale, b.y0 * scale, (b.x1 - b.x0) * scale, (b.y1 - b.y0) * scale);
    const enc = await encodeJpeg(crop, 1400, 0.85);
    const id = ctx.newId();
    await ctx.putImage(id, { data: enc.data, mime: 'image/jpeg', width: enc.width, height: enc.height });
    out.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, image: id });
  }
  return out;
}

const plain = (b: Block) =>
  b.kind === 'heading'
    ? b.content
        .map((c) => (c.t === 'text' ? c.text : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

/** "CHAPTER II" → "Chapter II"; fixes OCR's 1/l for I in Roman numerals. */
export function tidyHeading(t: string): string {
  let s = t.replace(/^\W+/, '').trim();
  s = s.replace(
    /^(chapter|part|book|section|lecture)\s+([IVXLCDM1l|](?:\s?[IVXLCDM1l|])*)(?=\s|$|[.:])/i,
    (_, w: string, n: string) => `${w} ${n.replace(/\s/g, '').replace(/[1l|]/g, 'I').toUpperCase()}`,
  );
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s(“"'-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
    s = s.replace(/\b([ivxlcdm]+)\b/gi, (m) => (/^[ivxlcdm]+$/i.test(m) && m.length <= 5 ? m.toUpperCase() : m));
  }
  return s;
}

function firstHeading(blocks: Block[]): string | undefined {
  const heads = blocks.slice(0, 12).filter((b) => b.kind === 'heading');
  for (let i = 0; i < heads.length; i++) {
    const t = tidyHeading(plain(heads[i]));
    if (t.length < 3 || t.length > 140 || !/\p{L}{3}/u.test(t)) continue;
    // "Chapter II" + "Of the Liberty of Thought" → "Chapter II: Of the Liberty of Thought"
    if (/^(chapter|part|book|section|lecture)\s+[\dIVXLCDM]+\.?$/i.test(t) && heads[i + 1]) {
      const next = tidyHeading(plain(heads[i + 1]));
      if (next.length >= 3 && next.length <= 120) return `${t}: ${next}`;
    }
    return t;
  }
  return undefined;
}
