// Autosave: the bundle, its page images and the original files are kept in
// the browser's IndexedDB so closing the tab doesn't lose finished OCR work.
// Nothing is ever uploaded.
import { createStore, del, delMany, get, keys, set } from 'idb-keyval';
import type { Bundle, StoredImage } from './model';

const store = createStore('epub-converter', 'kv');
const imageCache = new Map<string, StoredImage>();

export async function putImage(id: string, img: StoredImage): Promise<void> {
  imageCache.set(id, img);
  if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value!);
  await set(`img:${id}`, img, store);
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const hit = imageCache.get(id);
  if (hit) return hit;
  const img = await get<StoredImage>(`img:${id}`, store);
  if (img) imageCache.set(id, img);
  return img;
}

export async function deleteImages(ids: string[]): Promise<void> {
  ids.forEach((id) => imageCache.delete(id));
  if (ids.length) await delMany(ids.map((id) => `img:${id}`), store);
}

export async function putSources(readingId: string, files: File[]): Promise<void> {
  await set(`src:${readingId}`, files, store);
}

export async function getSources(readingId: string): Promise<File[] | undefined> {
  return get<File[]>(`src:${readingId}`, store);
}

export async function deleteSources(readingId: string): Promise<void> {
  await del(`src:${readingId}`, store);
}

export async function saveBundle(bundle: Bundle): Promise<void> {
  await set('bundle:current', JSON.parse(JSON.stringify(bundle)), store);
}

export async function loadBundle(): Promise<Bundle | undefined> {
  return get<Bundle>('bundle:current', store);
}

/** Removes everything except what the given bundle still references. */
export async function collectGarbage(bundle: Bundle): Promise<void> {
  const live = new Set<string>();
  for (const r of bundle.readings) {
    live.add(`src:${r.id}`);
    for (const p of r.pages) if (p.preview) live.add(`img:${p.preview}`);
    for (const b of r.blocks) if (b.kind === 'figure') live.add(`img:${b.image}`);
  }
  const all = (await keys(store)) as string[];
  const dead = all.filter((k) => (k.startsWith('img:') || k.startsWith('src:')) && !live.has(k));
  dead.forEach((k) => imageCache.delete(k.slice(4)));
  if (dead.length) await delMany(dead, store);
}

export async function clearAll(): Promise<void> {
  imageCache.clear();
  const all = (await keys(store)) as string[];
  if (all.length) await delMany(all, store);
}

export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

export async function storageUse(): Promise<{ usage: number; quota: number } | undefined> {
  try {
    const e = await navigator.storage?.estimate();
    if (e?.usage !== undefined && e.quota !== undefined) return { usage: e.usage, quota: e.quota };
  } catch {
    /* not supported */
  }
  return undefined;
}
