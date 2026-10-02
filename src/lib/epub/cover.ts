// Draws a simple, high-contrast cover so the bundle is easy to spot in the
// e-reader library: course/author, title, and the list of readings.
import type { BundleSettings, Reading, StoredImage } from '../model';

export async function makeCover(settings: BundleSettings, readings: Reading[]): Promise<StoredImage> {
  const W = 1200;
  const H = 1600;
  const M = 110;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'alphabetic';

  const serif = 'Georgia, "Times New Roman", serif';
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const wrap = (text: string, font: string, maxWidth: number, maxLines: number): string[] => {
    ctx.font = font;
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…';
      return kept;
    }
    return lines;
  };

  let y = M + 40;
  if (settings.author) {
    ctx.font = `600 34px ${sans}`;
    ctx.fillStyle = '#555555';
    ctx.fillText(settings.author.toUpperCase(), M, y);
    y += 80;
  }
  ctx.fillStyle = '#111111';
  const titleFont = `700 96px ${serif}`;
  for (const l of wrap(settings.title, titleFont, W - 2 * M, 4)) {
    ctx.font = titleFont;
    ctx.fillText(l, M, y + 70);
    y += 112;
  }
  y += 50;
  ctx.fillRect(M, y, 140, 6);
  y += 80;

  const listFont = `400 32px ${sans}`;
  const lineH = 50;
  const room = Math.floor((H - M - 80 - y) / lineH);
  const titles = readings.map((r) => r.title);
  const shown = titles.length > room ? titles.slice(0, Math.max(0, room - 1)) : titles;
  ctx.fillStyle = '#222222';
  for (const t of shown) {
    const [l] = wrap(t, listFont, W - 2 * M, 1);
    ctx.font = listFont;
    ctx.fillText(l, M, y);
    y += lineH;
  }
  if (shown.length < titles.length) {
    ctx.font = `italic 400 32px ${sans}`;
    ctx.fillStyle = '#555555';
    ctx.fillText(`+ ${titles.length - shown.length} more`, M, y);
  }

  ctx.font = `500 30px ${sans}`;
  ctx.fillStyle = '#555555';
  const count = `${readings.length} reading${readings.length === 1 ? '' : 's'}`;
  ctx.fillText(count, M, H - M);

  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('cover'))), 'image/jpeg', 0.9));
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: W, height: H };
}
