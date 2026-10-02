// Positioned text, as produced by the PDF text reader or by OCR, before it is
// turned into paragraphs. Coordinates have the origin at the top-left of the
// page, in pixels (OCR) or PDF points (text PDFs); only ratios matter.

export interface Span {
  text: string;
  sup?: boolean;
  i?: boolean;
  b?: boolean;
}

export interface Line {
  spans: Span[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Font size (text PDFs) or text height (OCR). */
  size: number;
  /** OCR confidence 0–100. */
  conf?: number;
  /** OCR paragraph id, when the OCR engine grouped lines into paragraphs. */
  para?: number;
}

export interface FigureRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Image id in storage. */
  image: string;
  caption?: string;
}

export interface PageLayout {
  width: number;
  height: number;
  lines: Line[];
  figures: FigureRegion[];
  /** Page label stored in the PDF itself (e.g. "47"), if any. */
  pdfLabel?: string;
  source: 'text' | 'ocr';
  /** Mean OCR confidence for the page. */
  confidence?: number;
  /** Preview image id for the review screen. */
  preview?: string;
}

export function lineText(l: Line): string {
  return l.spans.map((s) => s.text).join('');
}
