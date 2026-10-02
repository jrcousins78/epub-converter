// Loads photos and scans: converts iPhone HEIC, applies the phone's rotation,
// and splits two-page book spreads into separate pages.

export type Raster = HTMLCanvasElement;

export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export async function loadImage(file: Blob & { name?: string; type: string }): Promise<Raster> {
  let blob: Blob = file;
  if (isHeic(file as File)) {
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    blob = Array.isArray(out) ? out[0] : out;
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}

export function grayData(src: Raster): { gray: Uint8ClampedArray; width: number; height: number } {
  const { width, height } = src;
  const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return { gray, width, height };
}

/**
 * For a landscape photo of an open book, finds the binding (the column with the
 * least text-like detail near the middle). Returns undefined for single pages.
 */
export function findSpreadGutter(src: Raster): number | undefined {
  if (src.width < src.height * 1.15) return undefined;
  // Work on a small copy for speed.
  // A small, smoothly downscaled copy: averaging removes camera noise but keeps text lines.
  const scale = Math.min(1, 400 / src.width);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(src.width * scale));
  small.height = Math.max(1, Math.round(src.height * scale));
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const { gray, width, height } = grayData(small);

  // Vertical light/dark transitions per column ≈ amount of text in that column.
  const detail = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let t = 0;
    for (let y = 1; y < height; y++) if (Math.abs(gray[y * width + x] - gray[(y - 1) * width + x]) > 20) t++;
    detail[x] = t;
  }
  const smooth = (x: number) => {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const v = detail[x + k];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    return s / n;
  };
  const from = Math.floor(width * 0.4);
  const to = Math.ceil(width * 0.6);
  let best = from;
  let bestV = Infinity;
  for (let x = from; x <= to; x++) {
    const v = smooth(x);
    if (v < bestV) [bestV, best] = [v, x];
  }
  // Both halves must actually contain text.
  const avg = (a: number, b: number) => {
    let s = 0;
    for (let x = a; x < b; x++) s += detail[x];
    return s / Math.max(1, b - a);
  };
  const leftText = avg(Math.floor(width * 0.1), Math.floor(width * 0.4));
  const rightText = avg(Math.ceil(width * 0.6), Math.ceil(width * 0.9));
  if (leftText < 2 || rightText < 2 || bestV > 0.5 * Math.min(leftText, rightText)) return undefined;
  return Math.round(best / scale);
}

export function cropCanvas(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext('2d')!.drawImage(src, Math.round(x), Math.round(y), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

export function splitSpread(src: Raster): Raster[] {
  const g = findSpreadGutter(src);
  if (g === undefined) return [src];
  return [cropCanvas(src, 0, 0, g, src.height), cropCanvas(src, g, 0, src.width - g, src.height)];
}

export function rotateCanvas(src: Raster, quarterTurns: number): Raster {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return src;
  const c = document.createElement('canvas');
  c.width = q % 2 ? src.height : src.width;
  c.height = q % 2 ? src.width : src.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Encodes a canvas region as JPEG, limiting the longest edge. */
export async function encodeJpeg(
  src: Raster,
  maxEdge: number,
  quality = 0.82,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const s = Math.min(1, maxEdge / Math.max(src.width, src.height));
  let c = src;
  if (s < 1) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s));
    c.height = Math.max(1, Math.round(src.height * s));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
}
