// Cleans up a page image before OCR: scales it to a good working size,
// flattens uneven lighting (phone photos), and stretches contrast.
import { grayData, type Raster } from '../ingest/image';

export interface Prepared {
  canvas: HTMLCanvasElement;
  gray: Uint8ClampedArray;
  width: number;
  height: number;
  /** Factor from the source image's pixels to the prepared image's pixels. */
  scale: number;
}

const MIN_EDGE = 2200;
const MAX_EDGE = 3600;

export function prepareForOcr(src: Raster): Prepared {
  const long = Math.max(src.width, src.height);
  let scale = 1;
  if (long < MIN_EDGE) scale = Math.min(2.5, MIN_EDGE / long);
  if (long > MAX_EDGE) scale = MAX_EDGE / long;
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);

  const { gray } = grayData(work);
  flattenBackground(gray, width, height);
  stretchContrast(gray);

  const img = ctx.createImageData(width, height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = gray[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: work, gray, width, height, scale };
}

/**
 * Divides each pixel by a smooth estimate of the paper brightness around it.
 * This removes shadows and gradients from photos so the page becomes evenly white.
 */
export function flattenBackground(gray: Uint8ClampedArray, width: number, height: number): void {
  const cell = Math.max(16, Math.round(Math.max(width, height) / 60));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const bg = new Float32Array(gw * gh);
  // Paper brightness per cell = a high percentile of the cell's pixels.
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let n = 0;
      const x1 = Math.min(width, (gx + 1) * cell);
      const y1 = Math.min(height, (gy + 1) * cell);
      for (let y = gy * cell; y < y1; y += 2) for (let x = gx * cell; x < x1; x += 2) {
        hist[gray[y * width + x]]++;
        n++;
      }
      let target = n * 0.9;
      let v = 255;
      for (let k = 0; k < 256; k++) {
        target -= hist[k];
        if (target <= 0) {
          v = k;
          break;
        }
      }
      bg[gy * gw + gx] = v;
    }
  }
  // Smooth the grid (cells full of text or pictures borrow from their neighbours).
  const sm = new Float32Array(bg.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let m = 0;
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx;
            const y = gy + dy;
            if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
            const v = bg[y * gw + x];
            m = Math.max(m, v);
            s += v;
            n++;
          }
        sm[gy * gw + gx] = 0.5 * m + 0.5 * (s / n);
      }
    bg.set(sm);
  }
  // Bilinear upsample and divide.
  for (let y = 0; y < height; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const b =
        (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) + (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
      const i = y * width + x;
      gray[i] = b < 40 ? gray[i] : Math.min(255, (gray[i] * 255) / b);
    }
  }
}

/** Maps the darkest ~1% of pixels to black and keeps paper white. */
export function stretchContrast(gray: Uint8ClampedArray): void {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 3) hist[gray[i]]++;
  const total = Math.ceil(gray.length / 3);
  let acc = 0;
  let lo = 0;
  for (let k = 0; k < 256; k++) {
    acc += hist[k];
    if (acc >= total * 0.01) {
      lo = k;
      break;
    }
  }
  if (lo <= 5 || lo >= 200) return;
  const f = 255 / (255 - lo);
  for (let i = 0; i < gray.length; i++) gray[i] = gray[i] <= lo ? 0 : (gray[i] - lo) * f;
}
