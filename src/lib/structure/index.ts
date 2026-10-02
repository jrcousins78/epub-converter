// Rebuilds readable structure (paragraphs, headings, footnotes, figures and
// printed page numbers) from positioned lines of text.
import type { Block, Inline, Note, PageInfo } from '../model';
import { lineText, type FigureRegion, type Line, type PageLayout, type Span } from './types';

export interface StructureResult {
  pages: PageInfo[];
  blocks: Block[];
  notes: Note[];
}

// ---------------------------------------------------------------------------
// Small helpers

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

const ROMAN = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const TERMINAL = /[.!?:;"”’)\]…]$/;
const NOTE_START = /^\s*(?:[~_=·•'`"]+\s*)?(\d{1,3}|[*†‡§¶])(?:[.)]\s*|\s+)(?=\S)/;

/** Bigram similarity (Dice coefficient) for fuzzy matching of OCR'd headers. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hits = 0;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

const normHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/\d+/g, '')
    .replace(/\b[ivxlcdm]+\b/g, '')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();

function textOf(lines: Line[]): string {
  return lines.map(lineText).join(' ');
}

// ---------------------------------------------------------------------------
// Running headers, footers and printed page numbers

/** Finds a printed page number at the start or end of a header/footer line. */
export function pageNumberIn(text: string): string | undefined {
  const t = text.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, '');
  const m = t.match(/^(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(?:\s|$)/i) ?? t.match(/(?:^|\s)(\d{1,4}|[ivxlcdm]{1,7})$/i);
  if (!m) return undefined;
  const v = m[1];
  if (/^\d+$/.test(v)) return String(parseInt(v, 10));
  return ROMAN.test(v) && v.length <= 7 && (t.length <= 4 || /[a-z]/i.test(t.replace(v, ''))) ? v.toLowerCase() : undefined;
}

interface RunningResult {
  removed: Set<Line>;
  detected: (string | undefined)[];
}

export function findRunningLines(pages: PageLayout[]): RunningResult {
  const removed = new Set<Line>();
  const detected: (string | undefined)[] = pages.map(() => undefined);
  const candidates: { page: number; line: Line; norm: string; top: boolean }[] = [];

  const smallApart = new Set<Line>();
  pages.forEach((p, pi) => {
    const sorted = [...p.lines].sort((a, b) => a.y0 - b.y0);
    if (!sorted.length) return;
    const contentTop = sorted[0].y0;
    const contentBottom = Math.max(...sorted.map((l) => l.y1));
    const span = Math.max(1, contentBottom - contentTop);
    const zone = Math.max(0.1 * p.height, 0.07 * span);
    const pageSize = median(sorted.map((l) => l.size));
    const pick = (l: Line, top: boolean) => {
      const t = lineText(l);
      if (t.length > 120) return;
      const yc = (l.y0 + l.y1) / 2;
      const inZone = top ? yc - contentTop < zone && yc < 0.25 * p.height : contentBottom - yc < zone && yc > 0.75 * p.height;
      if (!inZone) return;
      candidates.push({ page: pi, line: l, norm: normHeader(t), top });
      // Small text set apart at the very top/bottom is a running head even if it appears only once.
      const idx = sorted.indexOf(l);
      const neighbour = top ? sorted[idx + 1] : sorted[idx - 1];
      const gap = neighbour ? (top ? neighbour.y0 - l.y1 : l.y0 - neighbour.y1) : Infinity;
      const outermost = top ? idx === 0 : idx === sorted.length - 1;
      const looksLikeNote = !top && NOTE_START.test(t);
      if (outermost && !looksLikeNote && sorted.length >= 6 && l.size <= pageSize * 0.9 && t.trim().length < 70 && gap >= l.size * 1.2) smallApart.add(l);
    };
    sorted.slice(0, 2).forEach((l) => pick(l, true));
    sorted.slice(-2).forEach((l) => {
      if (!sorted.slice(0, 2).includes(l) || sorted.length > 4) pick(l, false);
    });
  });

  // Text that repeats on many pages (book title, chapter title, journal name).
  const minRepeats = Math.max(2, Math.ceil(pages.length * 0.25));
  const repeated = (c: (typeof candidates)[number]) => {
    if (c.norm.length < 3) return false;
    const pagesWith = new Set<number>();
    for (const o of candidates) if (o.top === c.top && similarity(o.norm, c.norm) >= 0.75) pagesWith.add(o.page);
    return pagesWith.size >= minRepeats;
  };

  for (const c of candidates) {
    const t = lineText(c.line).trim();
    const num = pageNumberIn(t);
    const onlyNumber = num !== undefined && c.norm.length === 0;
    if (onlyNumber || smallApart.has(c.line) || repeated(c)) {
      removed.add(c.line);
      if (num !== undefined && detected[c.page] === undefined) detected[c.page] = num;
    }
  }
  return { removed, detected };
}

/** Chooses printed page labels: the PDF's own labels, else detected numbers made consistent. */
export function resolvePageLabels(detected: (string | undefined)[], pdfLabels: (string | undefined)[]): string[] {
  const n = detected.length;
  const nonTrivialPdf = pdfLabels.some((l, i) => l && l !== String(i + 1));
  if (nonTrivialPdf) return pdfLabels.map((l) => l ?? '');

  // Arabic numbers should increase by one per page; find the most common offset.
  const counts = new Map<number, number>();
  detected.forEach((d, i) => {
    if (d && /^\d+$/.test(d)) counts.set(parseInt(d, 10) - i, (counts.get(parseInt(d, 10) - i) ?? 0) + 1);
  });
  let best: number | undefined;
  let bestCount = 0;
  for (const [off, c] of counts) if (c > bestCount) [best, bestCount] = [off, c];
  const arabicSeen = [...counts.values()].reduce((a, b) => a + b, 0);
  const trusted = best !== undefined && (bestCount >= 2 || (arabicSeen === 1 && n <= 2)) && bestCount >= arabicSeen * 0.4;

  return detected.map((d, i) => {
    if (d && !/^\d+$/.test(d)) return d; // roman numerals (front matter) as found
    if (trusted && i + best! >= 1) return String(i + best!);
    return d ?? '';
  });
}

// ---------------------------------------------------------------------------
// Footnotes

interface PageNotes {
  notes: { marker: string; lines: Line[] }[];
  lines: Set<Line>;
}

export function findFootnotes(lines: Line[], bodySize: number, page: PageLayout): PageNotes {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0);
  const result: PageNotes = { notes: [], lines: new Set() };
  if (sorted.length < 3 || bodySize <= 0) return result;

  // Walk up from the bottom while lines are smaller than body text.
  const small = (l: Line) => l.size <= bodySize * 0.88;
  let start = sorted.length;
  while (start > 0 && small(sorted[start - 1])) start--;
  // The block must begin with a note marker; trim lines above the first marker.
  while (start < sorted.length && !NOTE_START.test(lineText(sorted[start]))) start++;
  if (start >= sorted.length) return result;
  const block = sorted.slice(start);
  if (block.length > sorted.length * 0.5) return result;
  if (block[0].y0 < page.height * 0.45) return result;

  for (const l of block) {
    const t = lineText(l);
    const m = t.match(NOTE_START);
    if (m) {
      const stripped = stripPrefix(l, m[0].length);
      result.notes.push({ marker: m[1], lines: [stripped] });
    } else if (result.notes.length) {
      result.notes[result.notes.length - 1].lines.push(l);
    }
    result.lines.add(l);
  }
  return result;
}

function stripPrefix(l: Line, chars: number): Line {
  const spans: Span[] = [];
  let left = chars;
  for (const s of l.spans) {
    if (left >= s.text.length) {
      left -= s.text.length;
      continue;
    }
    spans.push({ ...s, text: s.text.slice(left) });
    left = 0;
  }
  return { ...l, spans };
}

// ---------------------------------------------------------------------------
// Reading order (one or two columns)

type Item = { kind: 'line'; line: Line; col: number } | { kind: 'figure'; fig: FigureRegion; col: number };

export function readingOrder(lines: Line[], figures: FigureRegion[]): { items: Item[]; columns: { left: number; right: number }[] } {
  if (!lines.length) {
    return { items: figures.map((fig) => ({ kind: 'figure' as const, fig, col: 0 })), columns: [{ left: 0, right: 1 }] };
  }
  const L = Math.min(...lines.map((l) => l.x0));
  const R = Math.max(...lines.map((l) => l.x1));
  const W = Math.max(1, R - L);

  let gutter: number | undefined;
  if (lines.length >= 8) {
    let bestX = 0;
    let bestCross = Infinity;
    for (let f = 0.35; f <= 0.65; f += 0.01) {
      const x = L + f * W;
      const cross = lines.filter((l) => l.x0 < x - 2 && l.x1 > x + 2).length;
      if (cross < bestCross) [bestCross, bestX] = [cross, x];
    }
    const left = lines.filter((l) => l.x1 <= bestX + 2).length;
    const right = lines.filter((l) => l.x0 >= bestX - 2).length;
    if (bestCross <= lines.length * 0.15 && left >= lines.length * 0.2 && right >= lines.length * 0.2) gutter = bestX;
  }

  if (gutter === undefined) {
    const items: Item[] = [
      ...lines.map((line) => ({ kind: 'line' as const, line, col: 0 })),
      ...figures.map((fig) => ({ kind: 'figure' as const, fig, col: 0 })),
    ].sort((a, b) => top(a) - top(b));
    return { items, columns: [{ left: L, right: R }] };
  }

  const g = gutter;
  const colOf = (x0: number, x1: number) => (x1 <= g + 2 ? 1 : x0 >= g - 2 ? 2 : 0); // 0 = spans both
  const all: Item[] = [
    ...lines.map((line) => ({ kind: 'line' as const, line, col: colOf(line.x0, line.x1) })),
    ...figures.map((fig) => ({ kind: 'figure' as const, fig, col: colOf(fig.x0, fig.x1) })),
  ].sort((a, b) => top(a) - top(b));

  // Full-width items split the page into bands; each band is read left column first.
  const out: Item[] = [];
  let band: Item[] = [];
  const flush = () => {
    out.push(...band.filter((i) => i.col === 1), ...band.filter((i) => i.col === 2));
    band = [];
  };
  for (const it of all) {
    if (it.col === 0) {
      flush();
      out.push(it);
    } else band.push(it);
  }
  flush();
  return {
    items: out,
    columns: [
      { left: L, right: R },
      { left: L, right: g },
      { left: g, right: R },
    ],
  };

  function top(i: Item) {
    return i.kind === 'line' ? i.line.y0 : i.fig.y0;
  }
}

// ---------------------------------------------------------------------------
// Paragraphs

const CAPTION = /^(fig(ure)?|table|chart|map|plate|exhibit|illustration|graph)\.?\s*[\dIVX]/i;

/** Joins two pieces of text, removing end-of-line hyphenation. */
export function joinText(prev: string, next: string): { text: string; joiner: string } {
  if (/[\p{L}]-$/u.test(prev) && /^[\p{Ll}]/u.test(next)) return { text: prev.slice(0, -1), joiner: '' };
  if (/\s$/.test(prev) || /^\s/.test(next) || !prev) return { text: prev, joiner: '' };
  return { text: prev, joiner: ' ' };
}

/** Appends spans as-is (spans carry their own spacing), merging runs with the same style. */
function appendSpans(content: Inline[], spans: Span[]) {
  for (const s of spans) {
    if (!s.text) continue;
    const last = content[content.length - 1];
    if (last && last.t === 'text' && !!last.i === !!s.i && !!last.b === !!s.b && !!last.sup === !!s.sup) {
      last.text += s.text;
      continue;
    }
    content.push({ t: 'text', text: s.text, ...(s.i ? { i: true } : {}), ...(s.b ? { b: true } : {}), ...(s.sup ? { sup: true } : {}) });
  }
}

/** Adds a whole line to inline content (lines are joined with a space or de-hyphenated). */
function appendLine(content: Inline[], line: Line) {
  const spans = line.spans.map((s) => ({ ...s }));
  if (spans.length) spans[0] = { ...spans[0], text: spans[0].text.replace(/^\s+/, '') };
  const last = spans.length - 1;
  if (last >= 0) spans[last] = { ...spans[last], text: spans[last].text.replace(/\s+$/, '') };
  const prev = content[content.length - 1];
  if (prev && prev.t === 'text' && spans[0]) {
    const { text, joiner } = joinText(prev.text, spans[0].text);
    prev.text = text + joiner;
  } else if (prev && prev.t !== 'text' && spans[0]) {
    spans[0] = { ...spans[0], text: ' ' + spans[0].text };
  }
  appendSpans(content, spans);
}

export function contentText(content: Inline[]): string {
  return content.map((c) => (c.t === 'text' ? c.text : '')).join('');
}

/** A short line centred in its column with space around it (titles, subtitles). */
function centeredTitle(line: Line, col: { left: number; right: number; width: number; pitch: number }, prev?: Line, next?: Line): boolean {
  const t = lineText(line).trim();
  if (t.length < 3 || t.length > 120 || /[.,;]$/.test(t) || !/\p{L}{2}/u.test(t)) return false;
  const w = line.x1 - line.x0;
  const centre = (line.x0 + line.x1) / 2;
  const colCentre = (col.left + col.right) / 2;
  if (w > col.width * 0.8 || Math.abs(centre - colCentre) > col.width * 0.06) return false;
  const before = prev ? line.y0 - prev.y0 : Infinity;
  const after = next ? next.y0 - line.y0 : Infinity;
  return before >= col.pitch * 1.35 && after >= col.pitch * 1.3;
}

function headingLevel(line: Line, bodySize: number): 1 | 2 | 3 | undefined {
  const t = lineText(line).trim();
  if (!t || t.length > 150 || !/\p{L}/u.test(t)) return undefined;
  if (line.size >= bodySize * 1.6) return 1;
  if (line.size >= bodySize * 1.22) return 2;
  const allBold = line.spans.every((s) => s.b || !s.text.trim());
  if (allBold && t.length < 100 && !/[.,;]$/.test(t)) return 3;
  return undefined;
}

interface PageBlocks {
  blocks: Block[];
  usedCaptions: Set<Line>;
}

function pageBlocks(lines: Line[], figures: FigureRegion[], bodySize: number, pageIndex: number): PageBlocks {
  const { items, columns } = readingOrder(lines, figures);
  const usedCaptions = new Set<Line>();
  const blocks: Block[] = [];

  // Column geometry for indent / short-line tests.
  const colStats = columns.map((c, ci) => {
    const ls = items.filter((i): i is Extract<Item, { kind: 'line' }> => i.kind === 'line' && i.col === ci).map((i) => i.line);
    const left = ls.length ? quantile(ls.map((l) => l.x0), 0.15) : c.left;
    const right = ls.length ? quantile(ls.map((l) => l.x1), 0.85) : c.right;
    const pitches: number[] = [];
    for (let k = 1; k < ls.length; k++) {
      const d = ls[k].y0 - ls[k - 1].y0;
      if (d > 0) pitches.push(d);
    }
    return { left, right, width: Math.max(1, right - left), pitch: median(pitches) || bodySize * 1.3 };
  });

  // Figure captions: a caption-like line just below (or above) a figure.
  for (const it of items) {
    if (it.kind !== 'figure' || it.fig.caption) continue;
    const near = lines
      .filter((l) => !usedCaptions.has(l) && CAPTION.test(lineText(l).trim()))
      .filter((l) => Math.abs(l.y0 - it.fig.y1) < bodySize * 4 || Math.abs(it.fig.y0 - l.y1) < bodySize * 4)
      .sort((a, b) => Math.abs(a.y0 - it.fig.y1) - Math.abs(b.y0 - it.fig.y1))[0];
    if (near) {
      // Include following caption lines that sit tight underneath.
      const capLines = [near];
      const rest = lines.filter((l) => l.y0 > near.y0).sort((a, b) => a.y0 - b.y0);
      for (const l of rest) {
        const prev = capLines[capLines.length - 1];
        if (l.y0 - prev.y1 < bodySize * 0.6 && Math.abs(l.x0 - near.x0) < bodySize * 3 && capLines.length < 4) capLines.push(l);
        else break;
      }
      capLines.forEach((l) => usedCaptions.add(l));
      it.fig.caption = textOf(capLines).trim();
    }
  }

  let para: { content: Inline[]; lines: Line[]; col: number } | undefined;
  let heading: { level: 1 | 2 | 3; content: Inline[]; last: Line } | undefined;
  let prevLine: { line: Line; col: number } | undefined;

  const flushPara = () => {
    if (para && contentText(para.content).trim()) {
      const st = colStats[para.col];
      const quote =
        para.lines.length >= 2 &&
        para.lines.slice(1).every((l) => l.x0 - st.left > bodySize * 1.5 && st.right - l.x1 > bodySize * 1.5);
      blocks.push({ kind: 'paragraph', content: para.content, page: pageIndex, ...(quote ? { style: 'quote' as const } : {}) });
    }
    para = undefined;
  };
  const flushHeading = () => {
    if (heading) blocks.push({ kind: 'heading', level: heading.level, content: heading.content, page: pageIndex });
    heading = undefined;
  };

  for (const it of items) {
    if (it.kind === 'figure') {
      flushPara();
      flushHeading();
      blocks.push({ kind: 'figure', image: it.fig.image, caption: it.fig.caption, page: pageIndex });
      prevLine = undefined;
      continue;
    }
    const line = it.line;
    if (usedCaptions.has(line)) continue;
    const text = lineText(line).trim();
    if (!text) continue;
    const st = colStats[it.col];
    const sameCol = items.filter((x): x is Extract<Item, { kind: 'line' }> => x.kind === 'line' && x.col === it.col).map((x) => x.line);
    const k = sameCol.indexOf(line);
    const level =
      headingLevel(line, bodySize) ??
      (line.size >= bodySize * 0.95 && centeredTitle(line, st, sameCol[k - 1], sameCol[k + 1]) ? 3 : undefined);

    if (level) {
      flushPara();
      const continuesHeading =
        heading && heading.level === level && prevLine && line.y0 - prevLine.line.y1 < line.size * 0.9 && it.col === prevLine.col;
      if (!continuesHeading) {
        flushHeading();
        heading = { level, content: [], last: line };
      }
      appendLine(heading!.content, line);
      heading!.last = line;
      prevLine = { line, col: it.col };
      continue;
    }
    flushHeading();

    let startNew = !para || para.col !== it.col;
    if (!startNew && prevLine) {
      const p = prevLine.line;
      const prevText = lineText(p).trim();
      const pitch = line.y0 - p.y0;
      const gap = pitch > st.pitch * 1.55 || pitch < 0;
      const indent = line.x0 - st.left > bodySize * 0.8 && !(p.x0 - st.left > bodySize * 0.8);
      const prevShort = st.right - p.x1 > st.width * 0.12 && TERMINAL.test(prevText);
      const ocrPara = line.para !== undefined && p.para !== undefined && line.para !== p.para && TERMINAL.test(prevText);
      startNew = gap || indent || prevShort || ocrPara;
    }
    if (startNew) {
      flushPara();
      para = { content: [], lines: [], col: it.col };
    }
    appendLine(para!.content, line);
    para!.lines.push(line);
    prevLine = { line, col: it.col };
  }
  flushPara();
  flushHeading();
  return { blocks, usedCaptions };
}

// ---------------------------------------------------------------------------
// Note reference linking

function linkNoteRefs(blocks: Block[], notes: Note[]) {
  for (const note of notes) {
    const esc = note.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A marker glued to the end of a word or sentence ("fact.1", "society1"); not "Chapter I1".
    const pattern = new RegExp(`(?<=[\\p{Ll}.,;:!?’”"')\\]])${esc}(?=[\\s,.;:)]|$)`, 'u');
    // OCR often reads a superscript "1" as "!" or "'" right after punctuation.
    const lookalike = note.marker === '1' ? /(?<=[.,;:])[!|](?=\s|$)/u : undefined;
    let done = false;
    for (const b of blocks) {
      if (done) break;
      if ((b.kind !== 'paragraph' && b.kind !== 'heading') || b.page !== note.page) continue;
      for (let k = 0; k < b.content.length && !done; k++) {
        const c = b.content[k];
        if (c.t !== 'text') continue;
        if (c.sup && c.text.trim() === note.marker) {
          b.content.splice(k, 1, { t: 'noteref', note: note.id });
          done = true;
          break;
        }
        if (b.kind === 'heading') continue; // only true superscripts count in headings
        const m = pattern.exec(c.text) ?? (lookalike && !c.sup ? lookalike.exec(c.text) : null);
        if (m && !c.sup) {
          const before = c.text.slice(0, m.index);
          const after = c.text.slice(m.index + m[0].length);
          const parts: Inline[] = [];
          if (before) parts.push({ ...c, text: before });
          parts.push({ t: 'noteref', note: note.id });
          if (after) parts.push({ ...c, text: after });
          b.content.splice(k, 1, ...parts);
          done = true;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Whole reading

export function bodyFontSize(pages: PageLayout[]): number {
  const sizes: number[] = [];
  for (const p of pages)
    for (const l of p.lines) {
      const n = Math.min(80, Math.ceil(lineText(l).length / 10));
      for (let k = 0; k < n; k++) sizes.push(l.size);
    }
  return median(sizes);
}

export function buildStructure(pages: PageLayout[]): StructureResult {
  // Very low-confidence, tiny OCR fragments are almost always scan noise.
  const clean = pages.map((p) => ({
    ...p,
    lines: p.lines.filter((l) => {
      const t = lineText(l).trim();
      if (!t) return false;
      if (l.conf !== undefined && l.conf < 35 && t.length <= 3) return false;
      return true;
    }),
  }));

  const { removed, detected } = findRunningLines(clean);
  const labels = resolvePageLabels(
    detected,
    clean.map((p) => p.pdfLabel),
  );
  const bodySize = bodyFontSize(clean.map((p) => ({ ...p, lines: p.lines.filter((l) => !removed.has(l)) })));

  const infos: PageInfo[] = clean.map((p, i) => ({
    label: labels[i] ?? '',
    source: p.source,
    ...(p.confidence !== undefined ? { confidence: Math.round(p.confidence) } : {}),
    ...(p.preview ? { preview: p.preview } : {}),
  }));

  const blocks: Block[] = [];
  const notes: Note[] = [];

  clean.forEach((p, pi) => {
    const body = p.lines.filter((l) => !removed.has(l));
    const fn = findFootnotes(body, bodySize, p);
    const pageNotes: Note[] = fn.notes.map((n, k) => {
      const content: Inline[] = [];
      n.lines.forEach((l) => appendLine(content, l));
      return { id: `n${pi + 1}-${k + 1}`, marker: n.marker, content, page: pi };
    });
    const textLines = body.filter((l) => !fn.lines.has(l));
    const { blocks: pb } = pageBlocks(textLines, p.figures, bodySize, pi);
    linkNoteRefs(pb, pageNotes);

    // Continue a paragraph that runs over from the previous page.
    const first = pb[0];
    const prev = blocks[blocks.length - 1];
    if (first?.kind === 'paragraph' && prev?.kind === 'paragraph' && first.style === prev.style) {
      const prevText = contentText(prev.content).trim();
      const firstText = contentText(first.content).trim();
      const runsOn =
        prevText.length > 0 &&
        firstText.length > 0 &&
        (!TERMINAL.test(prevText) || /[\p{L}]-$/u.test(prevText) || /^[\p{Ll}]/u.test(firstText));
      if (runsOn) {
        const rest = first.content.map((c, k) => (k === 0 && c.t === 'text' ? { ...c, text: c.text.replace(/^\s+/, '') } : c));
        const last = prev.content[prev.content.length - 1];
        const head = rest[0];
        if (last?.t === 'text' && head?.t === 'text' && /[\p{L}]-$/u.test(last.text.trimEnd()) && /^[\p{Ll}]/u.test(head.text)) {
          // A word hyphenated across the page break: keep it whole, put the marker after it.
          const word = head.text.match(/^\S+/)![0];
          last.text = last.text.trimEnd().slice(0, -1) + word;
          head.text = head.text.slice(word.length);
        } else if (last?.t === 'text') {
          last.text = last.text.replace(/\s+$/, '') + ' ';
        }
        prev.content.push({ t: 'pb', page: pi }, ...rest);
        pb.shift();
      }
    }
    blocks.push(...pb);
    notes.push(...pageNotes);
  });

  // Pages whose content all merged into earlier blocks still need their marker:
  // the renderer emits markers from block.page and inline page breaks.
  return { pages: infos, blocks, notes };
}
