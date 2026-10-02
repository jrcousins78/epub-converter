// Characters that are not allowed in XML 1.0 documents (control characters,
// lone surrogates, non-characters). OCR output occasionally contains these.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(s: string): string {
  return s.replace(INVALID_XML, '');
}

export function esc(s: string): string {
  return cleanText(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const encoder = new TextEncoder();
export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}
