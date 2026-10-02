import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { buildEpub, epubFileName, orderReadings } from '../../src/lib/epub/build';
import { crc32 } from '../../src/lib/epub/zip';
import { sentences } from '../../src/lib/epub/render';
import { defaultSettings, type Reading, type StoredImage } from '../../src/lib/model';

// 1x1 white PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAG7buVgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
const IMG: StoredImage = { data: PNG, mime: 'image/png', width: 1, height: 1 };

function reading(over: Partial<Reading> = {}): Reading {
  return {
    id: 'r1',
    title: 'The Sociological Imagination',
    author: 'C. Wright Mills',
    course: 'SOC 101',
    fileName: 'mills.pdf',
    fileType: 'pdf',
    status: 'done',
    progress: 1,
    pages: [
      { label: '3', source: 'text' },
      { label: '4', source: 'text' },
      { label: '5', source: 'ocr', confidence: 88 },
    ],
    blocks: [
      { kind: 'heading', level: 1, content: [{ t: 'text', text: 'The Sociological Imagination' }], page: 0 },
      { kind: 'heading', level: 2, content: [{ t: 'text', text: 'The Promise' }], page: 0 },
      {
        kind: 'paragraph',
        page: 0,
        content: [
          { t: 'text', text: 'Nowadays men often feel that their private lives are a series of traps. ' },
          { t: 'noteref', note: 'n1' },
          { t: 'text', text: ' They sense that ' },
          { t: 'pb', page: 1 },
          { t: 'text', text: 'within their everyday worlds, they cannot overcome their troubles & <worries>.' },
        ],
      },
      { kind: 'figure', image: 'fig1', caption: 'Figure 1. A chart', page: 1 },
      { kind: 'heading', level: 3, content: [{ t: 'text', text: 'A subsection' }], page: 2 },
      { kind: 'list', ordered: false, items: [[{ t: 'text', text: 'one' }], [{ t: 'text', text: 'two', i: true }]], page: 2 },
      { kind: 'table', rows: [[[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }]]], page: 2 },
    ],
    notes: [{ id: 'n1', marker: '1', content: [{ t: 'text', text: 'See also Weber (1922).' }], page: 0 }],
    ...over,
  };
}

async function build(readings: Reading[], settingsOver = {}) {
  const chunks: Uint8Array[] = [];
  const result = await buildEpub(
    {
      settings: { ...defaultSettings(), title: 'SOC 101 – Week 1', ...settingsOver },
      readings,
      getImage: async (id) => (id === 'fig1' ? IMG : undefined),
      cover: IMG,
      now: new Date('2026-10-02T12:00:00Z'),
      identifier: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    },
    (c) => {
      chunks.push(c);
    },
  );
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  return { result, bytes };
}

function save(name: string, bytes: Uint8Array) {
  mkdirSync('test-results/epubs', { recursive: true });
  writeFileSync(`test-results/epubs/${name}`, bytes);
}

describe('zip', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
});

describe('sentences', () => {
  it('splits text into sentences without losing characters', () => {
    const t = 'One. Two? "Three!" Four';
    expect(sentences(t).join('')).toBe(t);
    expect(sentences(t)).toHaveLength(4);
  });
});

describe('buildEpub', () => {
  it('writes mimetype first, uncompressed, with no extra field', async () => {
    const { bytes } = await build([reading()]);
    const ascii = new TextDecoder().decode(bytes.slice(30, 58));
    expect(ascii).toBe('mimetypeapplication/epub+zip');
    const v = new DataView(bytes.buffer);
    expect(v.getUint16(8, true)).toBe(0); // stored
    expect(v.getUint16(28, true)).toBe(0); // no extra field
    expect(v.getUint16(6, true) & 0x08).toBe(0); // no data descriptor
    save('unit-basic.epub', bytes);
  });

  it('produces a readable archive with TOC, page markers, notes and images', async () => {
    const { bytes, result } = await build([reading()]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('The Sociological Imagination');
    expect(nav).toContain('The Promise');
    expect(nav).toContain('A subsection');
    expect(nav).toContain('epub:type="page-list"');
    const body = await zip.file('OEBPS/text/r01-01.xhtml')!.async('string');
    expect(body).toContain('[p.&#160;3]');
    expect(body).toContain('[p.&#160;4]');
    expect(body).toContain('troubles &amp; &lt;worries&gt;');
    expect(body).toContain('epub:type="noteref"');
    // The heading that repeats the title is not duplicated.
    expect(body.match(/The Sociological Imagination/g)).toHaveLength(2); // <title> + <h1>
    const notes = await zip.file('OEBPS/text/r01-notes.xhtml')!.async('string');
    expect(notes).toContain('Weber (1922)');
    expect(notes).toContain('href="r01-01.xhtml#r01-nr1"');
    expect(zip.file('OEBPS/images/img1.png')).not.toBeNull();
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('properties="cover-image"');
    expect(result.fileName).toBe('SOC-101-Week-1.epub');
  });

  it('groups readings by course when more than one course is present', async () => {
    const a = reading({ id: 'a', title: 'Reading A', course: 'SOC 101' });
    const b = reading({ id: 'b', title: 'Reading B', course: 'HIST 210' });
    const c = reading({ id: 'c', title: 'Reading C', course: 'SOC 101' });
    expect(orderReadings([a, b, c]).ordered.map((r) => r.id)).toEqual(['a', 'c', 'b']);
    const { bytes } = await build([a, b, c]);
    const nav = await (await JSZip.loadAsync(bytes)).file('OEBPS/nav.xhtml')!.async('string');
    expect(nav.indexOf('SOC 101')).toBeLessThan(nav.indexOf('Reading C'));
    expect(nav.indexOf('Reading C')).toBeLessThan(nav.indexOf('HIST 210'));
    save('unit-courses.epub', bytes);
  });

  it('handles 40 readings and splits long readings into several files', async () => {
    const long = (i: number): Reading =>
      reading({
        id: `r${i}`,
        title: `Reading ${i}`,
        course: '',
        pages: Array.from({ length: 30 }, (_, p) => ({ label: String(100 + p), source: 'text' as const })),
        blocks: Array.from({ length: 600 }, (_, k) => ({
          kind: 'paragraph' as const,
          page: Math.floor(k / 20),
          content: [{ t: 'text' as const, text: `Paragraph ${k}. `.repeat(40) }],
        })),
        notes: [],
      });
    const { bytes, result } = await build(Array.from({ length: 40 }, (_, i) => long(i + 1)));
    expect(result.files.filter((f) => f.startsWith('OEBPS/text/r01-')).length).toBeGreaterThan(1);
    const zip = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(zip.files)) {
      if (name.endsWith('.xhtml')) {
        const s = await zip.file(name)!.async('string');
        expect(s.length).toBeLessThan(300_000);
      }
    }
    save('unit-40-readings.epub', bytes);
  });

  it('produces Kobo markup and a .kepub.epub name when asked', async () => {
    const { bytes, result } = await build([reading()], { kepub: true });
    expect(result.fileName).toBe('SOC-101-Week-1.kepub.epub');
    const body = await (await JSZip.loadAsync(bytes)).file('OEBPS/text/r01-01.xhtml')!.async('string');
    expect(body).toContain('class="koboSpan"');
    expect(body).toContain('id="book-columns"');
    const ids = [...body.matchAll(/id="(kobo\.[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    save('unit-kepub.epub', bytes);
  });

  it('builds without page markers or section entries when turned off', async () => {
    const { bytes } = await build([reading()], { pageMarkers: false, sectionsInToc: false });
    const zip = await JSZip.loadAsync(bytes);
    const body = await zip.file('OEBPS/text/r01-01.xhtml')!.async('string');
    expect(body).not.toContain('[p.');
    expect(body).toContain('epub:type="pagebreak"');
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).not.toContain('The Promise');
  });

  it('sanitises file names', () => {
    expect(epubFileName({ ...defaultSettings(), title: 'Psych 201 — Week 5: Memory & Learning' })).toBe(
      'Psych-201-Week-5-Memory-Learning.epub',
    );
  });
});
