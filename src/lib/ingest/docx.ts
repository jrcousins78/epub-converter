// Reads Word (.docx) files with mammoth.js and maps the HTML it produces
// onto the shared block model (headings, paragraphs, lists, tables, images,
// footnotes).
import type { Block, Inline, Note } from '../model';

export interface DocxResult {
  title?: string;
  blocks: Block[];
  notes: Note[];
  images: { id: string; data: Uint8Array; mime: 'image/jpeg' | 'image/png'; width: number; height: number }[];
}

interface Mammoth {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: unknown): Promise<{ value: string }>;
  images: { imgElement(f: (img: { contentType: string; read(enc: 'base64'): Promise<string> }) => Promise<{ src: string }>): unknown };
}

export async function readDocx(data: ArrayBuffer, newId: () => string): Promise<DocxResult> {
  const mammoth = (await import('mammoth')) as unknown as Mammoth & { default?: Mammoth };
  const m: Mammoth = mammoth.default ?? mammoth;
  const html = (
    await m.convertToHtml(
      { arrayBuffer: data },
      {
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh"],
        convertImage: m.images.imgElement(async (img) => ({ src: `data:${img.contentType};base64,${await img.read('base64')}` })),
      },
    )
  ).value;
  return htmlToBlocks(html, newId);
}

export async function htmlToBlocks(html: string, newId: () => string): Promise<DocxResult> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: Block[] = [];
  const notes: Note[] = [];
  const images: DocxResult['images'] = [];
  const noteIds = new Map<string, string>(); // mammoth footnote element id -> our note id

  // Footnotes/endnotes: mammoth emits <ol><li id="footnote-1">… <a href="#footnote-ref-1">↑</a></li></ol>.
  for (const li of Array.from(doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]'))) {
    const id = `n${notes.length + 1}`;
    noteIds.set(li.id, id);
    li.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((a) => a.remove());
    notes.push({ id, marker: String(notes.length + 1), content: inlines(li) });
    const list = li.parentElement;
    li.remove();
    if (list && !list.querySelector('li')) list.remove();
  }

  async function addImage(img: HTMLImageElement): Promise<string | undefined> {
    const src = img.getAttribute('src') ?? '';
    const m = src.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
    if (!m) return undefined;
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    let data = bytes;
    let mime: 'image/jpeg' | 'image/png' = m[1] === 'image/png' ? 'image/png' : 'image/jpeg';
    let width = 0;
    let height = 0;
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: m[1] }));
      width = bmp.width;
      height = bmp.height;
      if (m[1] !== 'image/png' && m[1] !== 'image/jpeg') {
        // Re-encode formats e-readers may not support (EMF, GIF, TIFF, …) as PNG.
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        if (!blob) return undefined;
        data = new Uint8Array(await blob.arrayBuffer());
        mime = 'image/png';
      }
      bmp.close();
    } catch {
      return undefined;
    }
    const id = newId();
    images.push({ id, data, mime, width, height });
    return id;
  }

  function inlines(el: Element): Inline[] {
    const out: Inline[] = [];
    const walk = (node: Node, st: { i?: boolean; b?: boolean; sup?: boolean }) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ');
        if (!text) return;
        const last = out[out.length - 1];
        if (last && last.t === 'text' && !!last.i === !!st.i && !!last.b === !!st.b && !!last.sup === !!st.sup) last.text += text;
        else out.push({ t: 'text', text, ...(st.i ? { i: true } : {}), ...(st.b ? { b: true } : {}), ...(st.sup ? { sup: true } : {}) });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const e = node as Element;
      const tag = e.tagName.toLowerCase();
      if (tag === 'a' && /^#(foot|end)note-\d+/.test(e.getAttribute('href') ?? '')) {
        const target = (e.getAttribute('href') ?? '').slice(1);
        const nid = noteIds.get(target);
        if (nid) out.push({ t: 'noteref', note: nid });
        return;
      }
      if (tag === 'br') {
        walk(document.createTextNode(' '), st);
        return;
      }
      if (tag === 'img') return;
      const next = {
        i: st.i || tag === 'em' || tag === 'i',
        b: st.b || tag === 'strong' || tag === 'b',
        sup: st.sup || tag === 'sup',
      };
      e.childNodes.forEach((c) => walk(c, next));
    };
    el.childNodes.forEach((c) => walk(c, {}));
    // Trim outer whitespace.
    const first = out[0];
    if (first?.t === 'text') first.text = first.text.replace(/^\s+/, '');
    const last = out[out.length - 1];
    if (last?.t === 'text') last.text = last.text.replace(/\s+$/, '');
    // A noteref inside <sup> leaves an empty sup run behind.
    return out.filter((c) => c.t !== 'text' || c.text.length > 0);
  }

  async function visit(el: Element, quote = false) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(3, Number(tag[1])) as 1 | 2 | 3;
      const content = inlines(el);
      if (content.length) blocks.push({ kind: 'heading', level, content });
      return;
    }
    if (tag === 'p') {
      for (const img of Array.from(el.querySelectorAll('img'))) {
        const id = await addImage(img as HTMLImageElement);
        if (id) blocks.push({ kind: 'figure', image: id, alt: img.getAttribute('alt') ?? undefined });
      }
      const content = inlines(el);
      if (content.some((c) => c.t !== 'text' || c.text.trim())) blocks.push({ kind: 'paragraph', content, ...(quote ? { style: 'quote' as const } : {}) });
      return;
    }
    if (tag === 'blockquote') {
      for (const c of Array.from(el.children)) await visit(c, true);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => inlines(li));
      if (items.length) blocks.push({ kind: 'list', ordered: tag === 'ol', items });
      return;
    }
    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => inlines(td)));
      if (rows.length) blocks.push({ kind: 'table', rows });
      return;
    }
    if (tag === 'img') {
      const id = await addImage(el as HTMLImageElement);
      if (id) blocks.push({ kind: 'figure', image: id });
      return;
    }
    for (const c of Array.from(el.children)) await visit(c, quote);
  }

  for (const c of Array.from(doc.body.children)) await visit(c);

  const firstHeading = blocks.find((b) => b.kind === 'heading');
  const title = firstHeading?.kind === 'heading' ? firstHeading.content.map((c) => (c.t === 'text' ? c.text : '')).join('').trim() : undefined;
  return { title: title || undefined, blocks, notes, images };
}
