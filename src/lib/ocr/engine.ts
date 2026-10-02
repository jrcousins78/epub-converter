// Runs Tesseract.js OCR in a pool of background workers. The engine and the
// English language data are served from this site (public/vendor), so OCR
// works without a third-party CDN; other languages are fetched on demand.
import { createScheduler, createWorker, OEM, type Scheduler, type Page as TesseractPage } from 'tesseract.js';
import type { Line, Span } from '../structure/types';
import { assetUrl } from '../util/assets';

let scheduler: Scheduler | undefined;
let loadedLang = '';
let starting: Promise<Scheduler> | undefined;

export function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

async function start(lang: string): Promise<Scheduler> {
  if (scheduler && loadedLang === lang) return scheduler;
  if (starting && loadedLang === lang) return starting;
  await stopOcr();
  loadedLang = lang;
  starting = (async () => {
    const s = createScheduler();
    const onlyEnglish = lang.split('+').every((l) => l === 'eng');
    const n = poolSize();
    const created = await Promise.all(
      Array.from({ length: n }, () =>
        createWorker(lang, OEM.LSTM_ONLY, {
          workerPath: assetUrl('vendor/tesseract/worker.min.js'),
          corePath: assetUrl('vendor/tesseract/core/'),
          ...(onlyEnglish ? { langPath: assetUrl('vendor/tesseract/lang') } : {}),
          gzip: true,
        }),
      ),
    );
    for (const w of created) {
      await w.setParameters({
        tessedit_pageseg_mode: '3' as never,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      s.addWorker(w);
    }
    scheduler = s;
    return s;
  })();
  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}

export async function stopOcr(): Promise<void> {
  const s = scheduler;
  scheduler = undefined;
  if (s) await s.terminate();
}

/**
 * Drops specks the OCR engine read as characters at the start or end of a line
 * (dirt, the shadow of the book's binding, a footnote rule read as "~").
 */
export function trimEdgeJunk<W extends { text: string; confidence: number }>(words: W[]): W[] {
  const junk = (w: W) => {
    const t = w.text.trim();
    if (!t) return true;
    if (!/[\p{L}\p{N}]/u.test(t)) return w.confidence < 85 || t.length <= 1;
    return t.length === 1 && !/^[aAI]$/.test(t) && w.confidence < 60;
  };
  let a = 0;
  let b = words.length;
  while (a < b && junk(words[a])) a++;
  while (b > a && junk(words[b - 1])) b--;
  return words.slice(a, b);
}

export interface OcrPage {
  lines: Line[];
  confidence: number;
  /** Boxes Tesseract classified as images. */
  imageBlocks: { x0: number; y0: number; x1: number; y1: number }[];
}

let paraCounter = 0;

export async function ocr(canvas: HTMLCanvasElement, lang: string): Promise<OcrPage> {
  const s = await start(lang);
  const res = (await s.addJob('recognize', canvas, { rotateAuto: true }, { blocks: true, text: false })) as {
    data: TesseractPage;
  };
  const page = res.data;
  const lines: Line[] = [];
  const imageBlocks: OcrPage['imageBlocks'] = [];
  for (const block of page.blocks ?? []) {
    if (/IMAGE/i.test(block.blocktype ?? '')) imageBlocks.push(block.bbox);
    for (const para of block.paragraphs ?? []) {
      const pid = ++paraCounter;
      for (const line of para.lines ?? []) {
        const spans: Span[] = [];
        const words = trimEdgeJunk(line.words);
        if (!words.length) continue;
        words.forEach((w, wi) => {
          const sep = wi < words.length - 1 ? ' ' : '';
          const syms = w.symbols ?? [];
          const supTail = (() => {
            let k = syms.length;
            while (k > 0 && syms[k - 1].is_superscript) k--;
            return k;
          })();
          if (syms.length && supTail === 0) {
            spans.push({ text: w.text, sup: true }, { text: sep });
          } else if (syms.length && supTail < syms.length) {
            const head = syms.slice(0, supTail).map((x) => x.text).join('');
            const tail = syms.slice(supTail).map((x) => x.text).join('');
            spans.push({ text: head }, { text: tail, sup: true }, { text: sep });
          } else {
            spans.push({ text: w.text + sep });
          }
        });
        const merged: Span[] = [];
        for (const sp of spans) {
          const last = merged[merged.length - 1];
          if (last && !!last.sup === !!sp.sup) last.text += sp.text;
          else if (sp.text) merged.push({ ...sp });
        }
        const rowH = line.rowAttributes?.rowHeight;
        const size = rowH && rowH > 0 ? rowH : line.bbox.y1 - line.bbox.y0;
        lines.push({
          spans: merged,
          x0: line.bbox.x0,
          y0: line.bbox.y0,
          x1: line.bbox.x1,
          y1: line.bbox.y1,
          size,
          conf: line.confidence,
          para: pid,
        });
      }
    }
  }
  return { lines, confidence: page.confidence ?? 0, imageBlocks };
}
