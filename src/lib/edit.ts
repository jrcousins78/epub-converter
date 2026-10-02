// Converts inline content to plain editable text and back. Note links and
// page markers are shown as ⟦note 1⟧ and ⟦p. 47⟧ tokens so they survive edits.
import { pageLabel, type Inline, type Reading } from './model';

export function toEditable(content: Inline[], reading: Reading): string {
  return content
    .map((c) => {
      if (c.t === 'text') return c.text;
      if (c.t === 'noteref') {
        const n = reading.notes.find((x) => x.id === c.note);
        return n ? `⟦note ${n.marker}⟧` : '';
      }
      return ` ⟦p. ${pageLabel(reading, c.page)}⟧ `;
    })
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const TOKEN = /⟦\s*(note|p\.)\s*([^⟧]*?)\s*⟧/g;

export function fromEditable(text: string, prev: Inline[], reading: Reading): Inline[] {
  if (toEditable(prev, reading) === text.trim()) return prev;
  const out: Inline[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (s) out.push({ t: 'text', text: s });
  };
  for (const m of text.matchAll(TOKEN)) {
    pushText(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[1] === 'note') {
      const fromPrev = prev
        .filter((c): c is Extract<Inline, { t: 'noteref' }> => c.t === 'noteref')
        .map((c) => reading.notes.find((n) => n.id === c.note))
        .find((n) => n?.marker === m[2]);
      const note = fromPrev ?? reading.notes.find((n) => n.marker === m[2]);
      if (note) out.push({ t: 'noteref', note: note.id });
    } else {
      const fromPrev = prev.find((c): c is Extract<Inline, { t: 'pb' }> => c.t === 'pb' && pageLabel(reading, c.page) === m[2]);
      const page = fromPrev?.page ?? reading.pages.findIndex((_, i) => pageLabel(reading, i) === m[2]);
      if (page >= 0) out.push({ t: 'pb', page });
    }
  }
  pushText(text.slice(last));
  // Tidy spaces around tokens.
  return out.map((c, i) => {
    if (c.t !== 'text') return c;
    let t = c.text.replace(/\s+/g, ' ');
    if (i === 0) t = t.trimStart();
    if (i === out.length - 1) t = t.trimEnd();
    return { ...c, text: t };
  }).filter((c) => c.t !== 'text' || c.text.length > 0);
}

/** Renumbers all pages consecutively from `first` (e.g. "first page is p. 112"). */
export function renumberPages(reading: Reading, first: number): Reading['pages'] {
  return reading.pages.map((p, i) => ({ ...p, label: String(first + i) }));
}
