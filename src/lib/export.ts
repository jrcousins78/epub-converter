// Builds the EPUB and hands it to the browser as a download. Very large
// bundles are streamed straight to disk where the browser supports it.
import type { Bundle } from './model';
import { buildEpub, epubFileName } from './epub/build';
import { makeCover } from './epub/cover';
import { getImage } from './storage';

/** Rough size of the finished EPUB in bytes (text compresses ~3x; images don't). */
export async function estimateSize(bundle: Bundle): Promise<number> {
  let text = 0;
  let images = 0;
  for (const r of bundle.readings) {
    if (r.status !== 'done') continue;
    text += JSON.stringify(r.blocks).length / 2 + JSON.stringify(r.notes).length / 2;
    for (const b of r.blocks) if (b.kind === 'figure') images += (await getImage(b.image))?.data.length ?? 0;
  }
  return Math.round(text / 3 + images + 200_000);
}

const STREAM_THRESHOLD = 150 * 1024 * 1024;

type SavePicker = (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}>;

export async function exportEpub(bundle: Bundle): Promise<{ fileName: string; bytes: number } | undefined> {
  const name = epubFileName(bundle.settings);
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  const big = (await estimateSize(bundle)) > STREAM_THRESHOLD;
  const done = bundle.readings.filter((r) => r.status === 'done');
  const cover = await makeCover(bundle.settings, done);
  const input = { settings: bundle.settings, readings: done, getImage, cover };

  if (big && picker) {
    let handle;
    try {
      handle = await picker({ suggestedName: name, types: [{ description: 'EPUB book', accept: { 'application/epub+zip': ['.epub'] } }] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return undefined;
      handle = undefined;
    }
    if (handle) {
      const w = await handle.createWritable();
      try {
        const res = await buildEpub(input, (c) => w.write(c));
        await w.close();
        return { fileName: res.fileName, bytes: res.bytes };
      } catch (e) {
        await w.abort();
        throw e;
      }
    }
  }

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const res = await buildEpub(input, (c) => {
    chunks.push(c as Uint8Array<ArrayBuffer>);
  });
  const blob = new Blob(chunks, { type: 'application/epub+zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { fileName: res.fileName, bytes: res.bytes };
}
