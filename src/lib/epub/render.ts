// Turns one Reading into XHTML content documents.
import { inlineText, pageLabel, type Block, type Inline, type Reading } from '../model';
import { esc } from '../util/xml';
import { pad } from '../util/id';

export interface RenderOptions {
  pageMarkers: boolean;
  kepub: boolean;
  language: string;
  sectionsInToc: boolean;
}

export interface TocNode {
  label: string;
  /** Relative to the OEBPS root, e.g. "text/r01-01.xhtml#r01-h3". */
  href: string;
  children: TocNode[];
}

export interface PageTarget {
  label: string;
  href: string;
}

export interface RenderedFile {
  /** Relative to the OEBPS root. */
  path: string;
  id: string;
  xhtml: string;
}

export interface RenderedReading {
  files: RenderedFile[];
  toc: TocNode;
  pages: PageTarget[];
  images: Set<string>;
}

export interface ImageRef {
  /** Relative to the OEBPS root, e.g. "images/abc.jpg". */
  href: string;
  width: number;
  height: number;
}

/** Soft and hard limits for one XHTML file. Smaller files = faster page turns. */
const SOFT_CHUNK = 120_000;
const HARD_CHUNK = 250_000;

export function xhtmlDocument(title: string, body: string, lang: string, opts: { kepub: boolean; cssHref: string }): string {
  const inner = opts.kepub ? `<div id="book-columns"><div id="book-inner">${body}</div></div>` : body;
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">\n` +
    `<head>\n<meta charset="utf-8"/>\n<title>${esc(title)}</title>\n` +
    `<link rel="stylesheet" type="text/css" href="${opts.cssHref}"/>\n</head>\n` +
    `<body>\n${inner}\n</body>\n</html>\n`
  );
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Splits text into sentence-sized pieces for Kobo's koboSpan markup. */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*\s*|$)/g);
  if (!parts) return text ? [text] : [];
  const joined = parts.join('');
  // Keep any leftover characters the pattern didn't cover.
  if (joined.length < text.length) parts.push(text.slice(joined.length));
  return parts.filter((p) => p.length > 0);
}

export function renderReading(
  reading: Reading,
  index: number,
  opts: RenderOptions,
  imageRef: (id: string) => ImageRef | undefined,
): RenderedReading {
  const r = `r${pad(index + 1)}`;
  const notesFile = `${r}-notes.xhtml`;
  const images = new Set<string>();
  const pages: PageTarget[] = [];
  const emittedPages = new Set<number>();
  const noteRefIds = new Map<string, string[]>(); // note id -> ref element ids
  let koboPara = 0;
  let koboSeg = 0;
  let headingCount = 0;

  // Per-block bookkeeping so we can fix up hrefs once chunk files are known.
  interface Piece {
    html: string;
    isHeading: boolean;
    heading?: { level: number; id: string; label: string };
    pageIds: { page: number; id: string }[];
    refIds: string[];
  }
  let cur: Piece;

  const text = (s: string): string => {
    if (!opts.kepub) return esc(s);
    return sentences(s)
      .map((seg) => `<span class="koboSpan" id="kobo.${koboPara}.${++koboSeg}">${esc(seg)}</span>`)
      .join('');
  };

  const pageMarker = (page: number): string => {
    if (emittedPages.has(page)) return '';
    emittedPages.add(page);
    const id = `${r}-pg${page + 1}`;
    const label = pageLabel(reading, page);
    cur.pageIds.push({ page, id });
    const visible = opts.pageMarkers ? `[p.&#160;${esc(label)}]` : '';
    return `<span class="pg" epub:type="pagebreak" role="doc-pagebreak" id="${id}" title="${esc(label)}" aria-label="${esc(label)}">${visible}</span>`;
  };

  const inlines = (content: Inline[]): string => {
    let out = '';
    for (const c of content) {
      if (c.t === 'text') {
        let h = text(c.text);
        if (c.sup) h = `<sup>${h}</sup>`;
        if (c.i) h = `<i>${h}</i>`;
        if (c.b) h = `<b>${h}</b>`;
        out += h;
      } else if (c.t === 'pb') {
        const m = pageMarker(c.page);
        if (m) out += ` ${m} `;
      } else if (c.t === 'noteref') {
        const note = reading.notes.find((n) => n.id === c.note);
        if (!note) continue;
        const list = noteRefIds.get(note.id) ?? [];
        const refId = `${r}-nr${reading.notes.indexOf(note) + 1}${list.length ? `-${list.length + 1}` : ''}`;
        list.push(refId);
        noteRefIds.set(note.id, list);
        cur.refIds.push(refId);
        out += `<sup><a class="nref" epub:type="noteref" role="doc-noteref" id="${refId}" href="${notesFile}#${r}-n${reading.notes.indexOf(note) + 1}">${esc(note.marker)}</a></sup>`;
      }
    }
    return out.replace(/\s{2,}/g, ' ');
  };

  const startPage = (b: Block): string => (b.page !== undefined && !emittedPages.has(b.page) ? pageMarker(b.page) : '');

  // Skip a leading heading that just repeats the reading's title.
  let blocks = reading.blocks;
  const first = blocks[0];
  if (first?.kind === 'heading' && normalize(inlineText(first.content)) === normalize(reading.title)) {
    blocks = blocks.slice(1);
    if (first.page !== undefined) {
      // Keep the page marker of the skipped heading.
      blocks = [{ kind: 'paragraph', content: [{ t: 'pb', page: first.page }], page: first.page }, ...blocks];
    }
  }

  const pieces: Piece[] = [];
  for (const b of blocks) {
    cur = { html: '', isHeading: b.kind === 'heading', pageIds: [], refIds: [] };
    koboPara++;
    koboSeg = 0;
    switch (b.kind) {
      case 'heading': {
        const marker = startPage(b);
        const id = `${r}-h${++headingCount}`;
        const tag = `h${Math.min(6, b.level + 1)}`;
        const label = inlineText(b.content).trim().replace(/\s+/g, ' ');
        cur.heading = { level: b.level, id, label: label.length > 120 ? `${label.slice(0, 117)}…` : label };
        cur.html = (marker ? `<p class="pgline">${marker}</p>\n` : '') + `<${tag} id="${id}">${inlines(b.content)}</${tag}>`;
        break;
      }
      case 'paragraph': {
        const marker = startPage(b);
        const body = inlines(b.content).trim();
        if (!body && !marker) continue;
        const cls = b.style === 'quote' ? ' class="quote"' : '';
        cur.html = `<p${cls}>${marker}${marker && body ? ' ' : ''}${body}</p>`;
        break;
      }
      case 'list': {
        const marker = startPage(b);
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.map((it) => `<li>${inlines(it)}</li>`).join('\n');
        cur.html = (marker ? `<p class="pgline">${marker}</p>\n` : '') + `<${tag}>\n${items}\n</${tag}>`;
        break;
      }
      case 'table': {
        const marker = startPage(b);
        const rows = b.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inlines(cell)}</td>`).join('')}</tr>`)
          .join('\n');
        cur.html = (marker ? `<p class="pgline">${marker}</p>\n` : '') + `<table>\n<tbody>\n${rows}\n</tbody>\n</table>`;
        break;
      }
      case 'figure': {
        const ref = imageRef(b.image);
        const marker = startPage(b);
        if (!ref) {
          if (marker) cur.html = `<p class="pgline">${marker}</p>`;
          break;
        }
        images.add(b.image);
        const alt = esc(b.alt || b.caption || 'Figure');
        const cap = b.caption ? `\n<figcaption>${text(b.caption)}</figcaption>` : '';
        cur.html =
          (marker ? `<p class="pgline">${marker}</p>\n` : '') +
          `<figure>\n<img src="../${ref.href}" alt="${alt}" width="${ref.width}" height="${ref.height}"/>${cap}\n</figure>`;
        break;
      }
    }
    if (cur.html) pieces.push(cur);
  }

  // Any pages that produced no content (e.g. blank pages) still get a marker
  // at the end so the page list stays complete.
  const trailing: string[] = [];
  cur = { html: '', isHeading: false, pageIds: [], refIds: [] };
  for (let p = 0; p < reading.pages.length; p++) {
    if (!emittedPages.has(p) && reading.pages[p].source !== 'docx') trailing.push(pageMarker(p));
  }
  if (trailing.length) {
    cur.html = `<p class="pgline">${trailing.join(' ')}</p>`;
    pieces.push(cur);
  }

  // Group pieces into files.
  const header = readingHeader(reading, r, opts);
  const chunks: Piece[][] = [];
  let chunk: Piece[] = [];
  let size = header.length;
  for (const p of pieces) {
    const breakHere = chunk.length > 0 && (size + p.html.length > HARD_CHUNK || (p.isHeading && size > SOFT_CHUNK));
    if (breakHere) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(p);
    size += p.html.length;
  }
  chunks.push(chunk);

  const files: RenderedFile[] = [];
  const refFile = new Map<string, string>();
  const tocRoot: TocNode = { label: reading.title, href: `text/${r}-01.xhtml`, children: [] };
  const stack: { level: number; node: TocNode }[] = [];

  chunks.forEach((c, ci) => {
    const name = `${r}-${pad(ci + 1)}.xhtml`;
    for (const p of c) {
      for (const pg of p.pageIds) pages.push({ label: pageLabel(reading, pg.page), href: `text/${name}#${pg.id}` });
      for (const id of p.refIds) refFile.set(id, name);
      if (p.heading && opts.sectionsInToc && p.heading.label) {
        const node: TocNode = { label: p.heading.label, href: `text/${name}#${p.heading.id}`, children: [] };
        while (stack.length && stack[stack.length - 1].level >= p.heading.level) stack.pop();
        (stack.length ? stack[stack.length - 1].node.children : tocRoot.children).push(node);
        stack.push({ level: p.heading.level, node });
      }
    }
    const body = (ci === 0 ? header : '') + c.map((p) => p.html).join('\n');
    files.push({
      path: `text/${name}`,
      id: `${r}-${pad(ci + 1)}`,
      xhtml: xhtmlDocument(reading.title, body, opts.language, { kepub: opts.kepub, cssHref: '../css/style.css' }),
    });
  });

  if (reading.notes.length) {
    koboPara++;
    const items = reading.notes
      .map((n, i) => {
        koboPara++;
        koboSeg = 0;
        const refs = noteRefIds.get(n.id);
        const back = refs?.length
          ? `<a class="back" href="${refFile.get(refs[0])}#${refs[0]}" role="doc-backlink">${esc(n.marker)}.</a>`
          : `<span class="back">${esc(n.marker)}.</span>`;
        const where = n.page !== undefined ? ` <span class="where">(p.&#160;${esc(pageLabel(reading, n.page))})</span>` : '';
        cur = { html: '', isHeading: false, pageIds: [], refIds: [] };
        return `<li id="${r}-n${i + 1}" epub:type="endnote"><p>${back} ${inlines(n.content)}${where}</p></li>`;
      })
      .join('\n');
    const body =
      `<section epub:type="endnotes" role="doc-endnotes">\n<h2 id="${r}-notes">Notes</h2>\n` +
      `<p class="notes-for">${text(reading.title)}</p>\n<ul class="notes">\n${items}\n</ul>\n</section>`;
    files.push({
      path: `text/${notesFile}`,
      id: `${r}-notes`,
      xhtml: xhtmlDocument(`Notes – ${reading.title}`, body, opts.language, { kepub: opts.kepub, cssHref: '../css/style.css' }),
    });
  }

  return { files, toc: tocRoot, pages, images };

  function readingHeader(rd: Reading, rid: string, o: RenderOptions): string {
    const range = pageRange(rd);
    const source = [rd.fileName, range].filter(Boolean).join(' · ');
    const kobo = (s: string) => (o.kepub ? `<span class="koboSpan" id="kobo.0.${++koboSeg}">${esc(s)}</span>` : esc(s));
    koboSeg = 0;
    return (
      `<header class="reading-head">\n` +
      (rd.course ? `<p class="course">${kobo(rd.course)}</p>\n` : '') +
      `<h1 id="${rid}-title">${kobo(rd.title)}</h1>\n` +
      (rd.author ? `<p class="byline">${kobo(rd.author)}</p>\n` : '') +
      (source ? `<p class="source">${kobo(source)}</p>\n` : '') +
      `</header>\n`
    );
  }
}

/** "pp. 47–71" when printed page numbers are known. */
export function pageRange(reading: Reading): string {
  const labels = reading.pages.map((p) => p.label).filter(Boolean);
  if (!labels.length) return '';
  const a = labels[0];
  const b = labels[labels.length - 1];
  return a === b ? `p. ${a}` : `pp. ${a}–${b}`;
}
