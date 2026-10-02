import { describe, expect, it } from 'vitest';
import {
  buildStructure,
  contentText,
  joinText,
  pageNumberIn,
  readingOrder,
  resolvePageLabels,
  similarity,
} from '../../src/lib/structure';
import type { Line, PageLayout } from '../../src/lib/structure/types';
import type { Block } from '../../src/lib/model';

const W = 612;
const H = 792;

function L(text: string, y: number, o: Partial<Line> & { x0?: number; x1?: number } = {}): Line {
  const size = o.size ?? 11;
  return { spans: o.spans ?? [{ text }], x0: o.x0 ?? 72, x1: o.x1 ?? 540, y0: y, y1: y + size, size, ...o };
}

function page(lines: Line[], extra: Partial<PageLayout> = {}): PageLayout {
  return { width: W, height: H, lines, figures: [], source: 'text', ...extra };
}

/** Body lines with a 14pt pitch starting at y; `indentFirst` marks a new paragraph. */
function body(texts: string[], y = 100, indentFirst = false, short = -1): Line[] {
  return texts.map((t, i) => L(t, y + i * 14, { x0: indentFirst && i === 0 ? 90 : 72, x1: i === short ? 300 : 540 }));
}

const paras = (blocks: Block[]) => blocks.filter((b) => b.kind === 'paragraph').map((b) => contentText((b as any).content).trim());

describe('helpers', () => {
  it('finds page numbers in header/footer text', () => {
    expect(pageNumberIn('47')).toBe('47');
    expect(pageNumberIn('— 112 —')).toBe('112');
    expect(pageNumberIn('THE SOCIOLOGICAL IMAGINATION 9')).toBe('9');
    expect(pageNumberIn('12 Chapter One')).toBe('12');
    expect(pageNumberIn('xii')).toBe('xii');
    expect(pageNumberIn('Introduction')).toBeUndefined();
  });

  it('removes end-of-line hyphens only before lowercase letters', () => {
    expect(joinText('imagi-', 'nation')).toEqual({ text: 'imagi', joiner: '' });
    expect(joinText('Anglo-', 'Saxon')).toEqual({ text: 'Anglo-', joiner: ' ' });
    expect(joinText('the', 'next')).toEqual({ text: 'the', joiner: ' ' });
  });

  it('makes page labels consistent and fixes OCR misreads', () => {
    // "18" misread as "13" on the 3rd page; offset 15 wins.
    expect(resolvePageLabels(['16', '17', '13', undefined, '20'], [])).toEqual(['16', '17', '18', '19', '20']);
    expect(resolvePageLabels([undefined, undefined], [])).toEqual(['', '']);
    expect(resolvePageLabels([undefined, undefined], ['223', '224'])).toEqual(['223', '224']);
    // Trivial PDF labels (1, 2, 3) are ignored in favour of detected numbers.
    expect(resolvePageLabels(['5', '6'], ['1', '2'])).toEqual(['5', '6']);
  });

  it('measures fuzzy similarity for OCR-noisy headers', () => {
    expect(similarity('the sociological imagination', 'the soc1ological imaginati0n'.replace(/\d/g, ''))).toBeGreaterThan(0.75);
    expect(similarity('chapter one', 'notes and references')).toBeLessThan(0.4);
  });
});

describe('reading order', () => {
  it('reads two columns left first, with a full-width title on top', () => {
    const title = L('A Two Column Article', 60, { x0: 72, x1: 540, size: 18 });
    const left = Array.from({ length: 6 }, (_, i) => L(`left ${i}`, 100 + i * 14, { x0: 72, x1: 295 }));
    const right = Array.from({ length: 6 }, (_, i) => L(`right ${i}`, 100 + i * 14, { x0: 317, x1: 540 }));
    const { items } = readingOrder([...right, title, ...left], []);
    const order = items.map((i) => (i.kind === 'line' ? i.line.spans[0].text : 'fig'));
    expect(order).toEqual(['A Two Column Article', ...left.map((l) => l.spans[0].text), ...right.map((l) => l.spans[0].text)]);
  });
});

describe('buildStructure', () => {
  it('removes running headers and page numbers, and detects printed page labels', () => {
    const pages = [16, 17, 18].map((n, i) =>
      page([
        L(i % 2 ? 'THE SOCIOLOGICAL IMAGINATION' : 'The Promise', 40, { x0: 200, x1: 400, size: 9 }),
        ...body([`Text on page ${n} continues here with enough words to be body text.`, 'More body text follows on this line.'], 100),
        L(String(n), 750, { x0: 300, x1: 312, size: 9 }),
      ]),
    );
    // Running header text alternates; make both repeat at least twice.
    pages.push(
      page([
        L('THE SOCIOLOGICAL IMAGINATION', 40, { x0: 200, x1: 400, size: 9 }),
        ...body(['Final page body text.'], 100),
        L('19', 750, { x0: 300, x1: 312, size: 9 }),
      ]),
    );
    const r = buildStructure(pages);
    expect(r.pages.map((p) => p.label)).toEqual(['16', '17', '18', '19']);
    const all = paras(r.blocks).join(' ');
    expect(all).not.toMatch(/SOCIOLOGICAL/);
    expect(all).not.toMatch(/\b17\b(?! continues)/);
  });

  it('joins lines into paragraphs, splits on indent and removes hyphenation', () => {
    const lines = [
      ...body(['The first paragraph begins here and the imagi-', 'nation runs on to the end of it.'], 100, true, 1),
      ...body(['A second paragraph starts with an indent and', 'continues on a second line.'], 128, true),
    ];
    const r = buildStructure([page(lines)]);
    expect(paras(r.blocks)).toEqual([
      'The first paragraph begins here and the imagination runs on to the end of it.',
      'A second paragraph starts with an indent and continues on a second line.',
    ]);
  });

  it('detects headings by size and nests heading levels', () => {
    const r = buildStructure([
      page([
        L('Chapter One', 60, { size: 20, x1: 300 }),
        L('The Promise', 100, { size: 14, x1: 250 }),
        ...body(['Body text that is long enough to count as the body of the page.', 'And another body line.'], 130),
        ...body(['More body text that is long enough to count as the body of the page.', 'Final body line here.'], 170, true),
      ]),
    ]);
    const heads = r.blocks.filter((b) => b.kind === 'heading') as Extract<Block, { kind: 'heading' }>[];
    expect(heads.map((h) => [h.level, contentText(h.content)])).toEqual([
      [1, 'Chapter One'],
      [2, 'The Promise'],
    ]);
  });

  it('continues a paragraph across a page break with a page marker, keeping hyphenated words whole', () => {
    const p1 = page([...body(['A sentence that runs over the page and the soci-'], 100)]);
    const p2 = page([...body(['ety it describes is complicated.', 'A new line follows the first one here.'], 100)]);
    const r = buildStructure([p1, p2]);
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0] as Extract<Block, { kind: 'paragraph' }>;
    expect(b.content.some((c) => c.t === 'pb' && c.page === 1)).toBe(true);
    expect(contentText(b.content)).toContain('the society it describes');
  });

  it('starts a new block on the next page when the paragraph had ended', () => {
    const p1 = page(body(['A complete sentence ends here.'], 100));
    const p2 = page(body(['Another paragraph begins on the next page.'], 100, true));
    const r = buildStructure([p1, p2]);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[1].page).toBe(1);
  });

  it('extracts footnotes and links them to their markers', () => {
    const lines = [
      ...body(['Durkheim argued that suicide is a social fact.1 This claim was', 'controversial at the time and remains so today.'], 100),
      L('1 Émile Durkheim, Suicide (1897), p. 12.', 700, { size: 8.5, x1: 400 }),
      L('continued note text on a second line.', 711, { size: 8.5, x1: 300 }),
    ];
    const r = buildStructure([page(lines)]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].marker).toBe('1');
    expect(contentText(r.notes[0].content)).toBe('Émile Durkheim, Suicide (1897), p. 12. continued note text on a second line.');
    const p = r.blocks[0] as Extract<Block, { kind: 'paragraph' }>;
    expect(p.content.some((c) => c.t === 'noteref')).toBe(true);
    expect(contentText(p.content)).not.toMatch(/fact\.1/);
  });

  it('links superscript markers from text PDFs', () => {
    const lines = [
      L('', 100, { spans: [{ text: 'A claim with a marker' }, { text: '2', sup: true }, { text: ' and more text after it.' }] }),
      L('2 The source of the claim.', 700, { size: 8 }),
    ];
    const r = buildStructure([page([...lines, ...body(['Filler line one that is body text.', 'Filler line two.'], 114)])]);
    const p = r.blocks[0] as Extract<Block, { kind: 'paragraph' }>;
    expect(p.content.filter((c) => c.t === 'noteref')).toHaveLength(1);
  });

  it('places figures with captions in reading order', () => {
    const lines = [
      ...body(['Text above the figure is here.'], 100),
      L('Figure 1. Suicide rates by country, 1890.', 420, { size: 9, x1: 400 }),
      ...body(['Text below the figure is here.'], 460, true),
    ];
    const r = buildStructure([page(lines, { figures: [{ x0: 72, y0: 130, x1: 540, y1: 410, image: 'img1' }] })]);
    expect(r.blocks.map((b) => b.kind)).toEqual(['paragraph', 'figure', 'paragraph']);
    expect((r.blocks[1] as Extract<Block, { kind: 'figure' }>).caption).toBe('Figure 1. Suicide rates by country, 1890.');
  });

  it('drops tiny low-confidence OCR noise', () => {
    const r = buildStructure([page([...body(['Real text line here.'], 100), L('~', 300, { conf: 12 })], { source: 'ocr', confidence: 80 })]);
    expect(paras(r.blocks)).toEqual(['Real text line here.']);
    expect(r.pages[0].confidence).toBe(80);
  });
});

import { tidyHeading } from '../../src/lib/pipeline';
import { trimEdgeJunk } from '../../src/lib/ocr/engine';

describe('OCR clean-up', () => {
  it('tidies chapter headings used as titles', () => {
    expect(tidyHeading('CHAPTER I1')).toBe('Chapter II');
    expect(tidyHeading('CHAPTER I 1')).toBe('Chapter II');
    expect(tidyHeading('THE SOCIOLOGICAL IMAGINATION')).toBe('The Sociological Imagination');
    expect(tidyHeading('(Of the Liberty of Thought')).toBe('Of the Liberty of Thought');
  });

  it('drops specks at the edges of OCR lines but keeps real words', () => {
    const w = (text: string, confidence = 90) => ({ text, confidence });
    expect(trimEdgeJunk([w('~', 70), w('1'), w('These'), w('words')]).map((x) => x.text)).toEqual(['1', 'These', 'words']);
    expect(trimEdgeJunk([w('means'), w('of'), w(':', 40)]).map((x) => x.text)).toEqual(['means', 'of']);
    expect(trimEdgeJunk([w('is'), w('a')]).map((x) => x.text)).toEqual(['is', 'a']);
    expect(trimEdgeJunk([w('¢', 30), w('nty.')]).map((x) => x.text)).toEqual(['nty.']);
  });
});

import { titleFromFileName } from '../../src/lib/pipeline';

describe('titles from file names', () => {
  it('turns file names into readable titles', () => {
    expect(titleFromFileName('mill-scan.pdf')).toBe('Mill scan');
    expect(titleFromFileName('Smith - Chapter 3.pdf')).toBe('Smith – Chapter 3');
    expect(titleFromFileName('week_5_reading.docx')).toBe('Week 5 reading');
  });
});
