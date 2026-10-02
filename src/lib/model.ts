// The shared document model. Every input format (text PDF, scanned PDF,
// photo, Word document) is converted into a Reading, and the EPUB writer
// only ever sees Readings.

/** Inline content inside a paragraph, heading, list item or note. */
export type Inline =
  | { t: 'text'; text: string; i?: boolean; b?: boolean; sup?: boolean }
  /** Reference to a note in Reading.notes (by note id). */
  | { t: 'noteref'; note: string }
  /** The original page `page` (index into Reading.pages) starts here. */
  | { t: 'pb'; page: number };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; content: Inline[]; page?: number }
  | { kind: 'paragraph'; content: Inline[]; page?: number; style?: 'quote' }
  | { kind: 'list'; ordered: boolean; items: Inline[][]; page?: number }
  | { kind: 'table'; rows: Inline[][][]; page?: number }
  | { kind: 'figure'; image: string; alt?: string; caption?: string; page?: number };

export interface Note {
  id: string;
  /** The marker printed in the original ("1", "*", "†"). */
  marker: string;
  content: Inline[];
  page?: number;
}

export interface PageInfo {
  /** Printed page number as found in the source ("47", "xii"), or '' if unknown. */
  label: string;
  /** Mean OCR confidence 0–100 (only for OCR'd pages). */
  confidence?: number;
  source: 'text' | 'ocr' | 'docx';
  /** Image id of a page preview, used by the review screen. */
  preview?: string;
}

export type ReadingStatus = 'queued' | 'processing' | 'done' | 'error';

export interface Reading {
  id: string;
  title: string;
  author: string;
  course: string;
  fileName: string;
  fileType: 'pdf' | 'image' | 'docx';
  /** Identifies the source file(s) (name, size, date) so the same file isn't added twice. */
  sourceKey?: string;
  status: ReadingStatus;
  /** 0..1 */
  progress: number;
  message?: string;
  pages: PageInfo[];
  blocks: Block[];
  notes: Note[];
}

export interface BundleSettings {
  /** Book title shown in the e-reader library, e.g. "PSYC 201 – Week 5". */
  title: string;
  /** Shown as the book's author in the library. */
  author: string;
  /** BCP 47 language of the text, e.g. "en". */
  language: string;
  /** Tesseract language code(s) for OCR, e.g. "eng" or "eng+fra". */
  ocrLanguage: string;
  /** Show small "[p. 47]" markers in the text. */
  pageMarkers: boolean;
  /** List headings found inside each reading in the table of contents. */
  sectionsInToc: boolean;
  /** Output a Kobo-optimised .kepub.epub instead of a plain .epub. */
  kepub: boolean;
  /** File name (without extension) last chosen when saving this bundle. */
  fileName?: string;
}

export interface Bundle {
  id: string;
  settings: BundleSettings;
  readings: Reading[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredImage {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export function defaultSettings(): BundleSettings {
  return {
    title: 'Weekly readings',
    author: '',
    language: 'en',
    ocrLanguage: 'eng',
    pageMarkers: true,
    sectionsInToc: true,
    kepub: false,
  };
}

/** Plain text of a run of inline content (used for titles, TOC labels, matching). */
export function inlineText(content: Inline[]): string {
  return content.map((c) => (c.t === 'text' ? c.text : '')).join('');
}

/** Printed label for a page, falling back to its position in the file. */
export function pageLabel(reading: Reading, page: number): string {
  return reading.pages[page]?.label || String(page + 1);
}
