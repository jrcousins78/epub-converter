// App state: the current weekly bundle, the processing queue, selection and autosave.
import { SvelteSet } from 'svelte/reactivity';
import { defaultSettings, type Block, type Bundle, type BundleSettings, type Reading } from './model';
import { uid } from './util/id';
import { kindOf, processSources, titleFromFileName, type SourceKind } from './pipeline';
import * as storage from './storage';
import { exportEpub, estimateSize } from './export';
import { epubFileName, safeFileBase } from './epub/build';
import { crc32 } from './epub/zip';
import { delight } from './delight.svelte';

function emptyBundle(): Bundle {
  const now = Date.now();
  return { id: uid(), settings: defaultSettings(), readings: [], createdAt: now, updatedAt: now };
}

const FP_CHUNK = 64 * 1024;

/**
 * Identifies a file by its contents (size plus checksums of its start and end),
 * so the same reading is recognised even if it was renamed or downloaded twice.
 */
export async function fingerprint(f: Blob): Promise<string> {
  const head = new Uint8Array(await f.slice(0, FP_CHUNK).arrayBuffer());
  const tail = f.size > FP_CHUNK ? new Uint8Array(await f.slice(Math.max(FP_CHUNK, f.size - FP_CHUNK)).arrayBuffer()) : new Uint8Array();
  return `${f.size}:${crc32(head).toString(16)}:${crc32(tail).toString(16)}`;
}

export function keyOf(fingerprints: string[]): string {
  return [...fingerprints].sort().join(';');
}

export async function sourceKeyOf(files: Blob[]): Promise<string> {
  return keyOf(await Promise.all(files.map(fingerprint)));
}

/**
 * Readings that look like copies of an earlier one in the list: same source
 * file(s) or, for readings saved before source keys existed, same file name,
 * type and page count. Returns the ids of the later copies.
 */
export function findDuplicates(readings: Reading[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of readings) {
    const key = r.sourceKey ?? `${r.fileType}|${r.fileName}|${r.status === 'done' ? r.pages.length : '?'}`;
    if (seen.has(key)) dupes.push(r.id);
    else seen.add(key);
  }
  return dupes;
}

export interface Notice {
  text: string;
  action?: { label: string; run: () => void };
}

interface Removed {
  items: { reading: Reading; index: number; files?: File[] }[];
  timer: ReturnType<typeof setTimeout>;
}

class AppState {
  bundle = $state<Bundle>(emptyBundle());
  loaded = $state(false);
  building = $state(false);
  notice = $state<Notice | undefined>(undefined);
  estimate = $state<number | undefined>(undefined);
  reviewing = $state<string | undefined>(undefined);
  /** Ids of selected readings. */
  selected = new SvelteSet<string>();
  /** Name of the last EPUB saved in this session. */
  lastSaved = $state<string | undefined>(undefined);

  private sources = new Map<string, File[]>();
  private running = false;
  private current: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private rotate = new Map<string, number>();
  private removed: Removed | undefined;
  private anchor: string | undefined;

  get readings(): Reading[] {
    return this.bundle.readings;
  }

  get counts() {
    const r = this.bundle.readings;
    return {
      total: r.length,
      done: r.filter((x) => x.status === 'done').length,
      waiting: r.filter((x) => x.status === 'queued' || x.status === 'processing').length,
      failed: r.filter((x) => x.status === 'error').length,
      review: r.filter((x) => x.status === 'done' && x.pages.some((p) => p.confidence !== undefined && p.confidence < 70)).length,
    };
  }

  get duplicates(): string[] {
    return findDuplicates(this.bundle.readings);
  }

  async init() {
    try {
      const saved = await storage.loadBundle();
      if (saved) {
        saved.settings = { ...defaultSettings(), ...saved.settings };
        for (const r of saved.readings) if (r.status === 'processing') r.status = 'queued';
        this.bundle = saved;
      }
    } catch (e) {
      console.warn('Could not restore saved work', e);
    }
    this.loaded = true;
    void this.refreshEstimate();
    void this.processQueue();
  }

  /** Persist soon (debounced). */
  save() {
    this.bundle.updatedAt = Date.now();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void storage.saveBundle($state.snapshot(this.bundle) as Bundle).catch((e) => console.warn('Autosave failed', e));
    }, 400);
  }

  flash(text: string, action?: Notice['action'], ms = 6000) {
    const n: Notice = { text, action };
    this.notice = n;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (this.notice === n) this.notice = undefined;
    }, ms);
  }

  updateSettings(patch: Partial<BundleSettings>) {
    Object.assign(this.bundle.settings, patch);
    this.save();
  }

  private adding: Promise<void> = Promise.resolve();

  /**
   * PDFs and Word files become one reading each; photos dropped together become
   * one reading. Files already in the list (same contents) are skipped.
   */
  addFiles(files: File[]): Promise<void> {
    // One batch at a time, so two quick drops of the same file can't both get in.
    this.adding = this.adding.then(() => this.addBatch(files)).catch((e) => console.error(e));
    return this.adding;
  }

  private async addBatch(files: File[]) {
    const before = this.bundle.readings.length;
    const known = new Set<string>();
    for (const r of this.bundle.readings) if (r.sourceKey) for (const k of r.sourceKey.split(';')) known.add(k);
    for (const r of this.removed?.items ?? []) if (r.reading.sourceKey) for (const k of r.reading.sourceKey.split(';')) known.add(k);
    const prints = await Promise.all(files.map(fingerprint));
    const seenNow = new Set<string>();
    const photos: { file: File; print: string }[] = [];
    const skipped: string[] = [];
    const already: string[] = [];
    const added: Reading[] = [];
    const lastCourse = this.bundle.readings[this.bundle.readings.length - 1]?.course ?? '';
    const make = (fs: File[], fps: string[], kind: SourceKind, title: string): Reading => ({
      id: uid(),
      title,
      author: '',
      course: lastCourse,
      fileName: fs.length > 1 ? `${fs.length} photos` : fs[0].name,
      fileType: kind,
      sourceKey: keyOf(fps),
      status: 'queued',
      progress: 0,
      pages: [],
      blocks: [],
      notes: [],
    });
    files.forEach((f, i) => {
      const print = prints[i];
      if (seenNow.has(print)) return; // the same file twice in one drop
      seenNow.add(print);
      const kind = kindOf(f);
      if (!kind) {
        skipped.push(f.name);
        return;
      }
      if (known.has(print)) {
        already.push(f.name);
        return;
      }
      if (kind === 'image') {
        photos.push({ file: f, print });
        return;
      }
      const r = make([f], [print], kind, titleFromFileName(f.name));
      this.sources.set(r.id, [f]);
      added.push(r);
    });
    if (photos.length) {
      photos.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
      const fs = photos.map((p) => p.file);
      const r = make(fs, photos.map((p) => p.print), 'image', titleFromFileName(fs[0].name));
      this.sources.set(r.id, fs);
      added.push(r);
    }
    const notes: string[] = [];
    if (already.length) notes.push(`Already in the list: ${list(already)}`);
    if (skipped.length) notes.push(`Skipped files that aren't PDFs, photos or Word documents: ${list(skipped)}`);
    if (notes.length) this.flash(notes.join(' · '));
    if (!added.length) return;
    this.lastSaved = undefined;
    this.bundle.readings.push(...added);
    this.save();
    void storage.requestPersistence();
    for (const r of added) void storage.putSources(r.id, this.sources.get(r.id)!).catch(() => undefined);
    delight.readingsAdded(before, this.bundle.readings.length);
    void this.processQueue();
  }

  find(id: string): Reading | undefined {
    return this.bundle.readings.find((r) => r.id === id);
  }

  update(id: string, patch: Partial<Reading>) {
    const r = this.find(id);
    if (!r) return;
    Object.assign(r, patch);
    this.save();
  }

  updateBlocks(id: string, blocks: Block[]) {
    const r = this.find(id);
    if (!r) return;
    r.blocks = blocks;
    this.save();
    void this.refreshEstimate();
  }

  // --- Selection ---------------------------------------------------------------

  /** Click on a row's checkbox; with shift, selects the whole range from the last click. */
  toggleSelect(id: string, range = false) {
    const ids = this.bundle.readings.map((r) => r.id);
    if (range && this.anchor && ids.includes(this.anchor)) {
      const [a, b] = [ids.indexOf(this.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      const on = !this.selected.has(id) || this.selected.has(this.anchor);
      for (const x of ids.slice(a, b + 1)) on ? this.selected.add(x) : this.selected.delete(x);
    } else if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.anchor = id;
  }

  selectAll(on = true) {
    this.selected.clear();
    if (on) for (const r of this.bundle.readings) this.selected.add(r.id);
  }

  selectDuplicates() {
    this.selected.clear();
    for (const id of this.duplicates) this.selected.add(id);
  }

  clearSelection() {
    this.selected.clear();
    this.anchor = undefined;
  }

  setCourse(ids: string[], course: string) {
    for (const id of ids) {
      const r = this.find(id);
      if (r) r.course = course;
    }
    this.save();
  }

  // --- Removing (with undo) ----------------------------------------------------------

  remove(ids: string | string[]) {
    const list = new Set(Array.isArray(ids) ? ids : [ids]);
    if (!list.size) return;
    this.finalizeRemoval();
    const items = this.bundle.readings
      .map((reading, index) => ({ reading: $state.snapshot(reading) as Reading, index, files: this.sources.get(reading.id) }))
      .filter((x) => list.has(x.reading.id));
    if (!items.length) return;
    this.bundle.readings = this.bundle.readings.filter((r) => !list.has(r.id));
    for (const id of list) {
      this.selected.delete(id);
      if (this.reviewing === id) this.reviewing = undefined;
    }
    this.removed = { items, timer: setTimeout(() => this.finalizeRemoval(), 9000) };
    this.lastSaved = undefined;
    this.save();
    void this.refreshEstimate();
    const n = items.length;
    this.flash(n === 1 ? `Removed “${items[0].reading.title}”` : `Removed ${n} readings`, { label: 'Undo', run: () => this.undoRemove() }, 9000);
  }

  undoRemove() {
    const r = this.removed;
    if (!r) return;
    clearTimeout(r.timer);
    this.removed = undefined;
    const list = [...this.bundle.readings];
    for (const it of [...r.items].sort((a, b) => a.index - b.index)) {
      const reading = it.reading;
      if (reading.status === 'processing' && this.current !== reading.id) reading.status = 'queued';
      list.splice(Math.min(it.index, list.length), 0, reading);
      if (it.files) this.sources.set(reading.id, it.files);
    }
    this.bundle.readings = list;
    this.notice = undefined;
    this.save();
    void this.refreshEstimate();
    void this.processQueue();
  }

  /** After the undo window: forget the removed readings' files and images. */
  private finalizeRemoval() {
    const r = this.removed;
    if (!r) return;
    clearTimeout(r.timer);
    this.removed = undefined;
    for (const it of r.items) this.sources.delete(it.reading.id);
    void this.gc();
  }

  private gc() {
    const pending = this.removed?.items.map((x) => x.reading) ?? [];
    return storage.collectGarbage([...($state.snapshot(this.bundle.readings) as Reading[]), ...pending]);
  }

  move(from: number, to: number) {
    const list = this.bundle.readings;
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const [r] = list.splice(from, 1);
    list.splice(to, 0, r);
    this.save();
  }

  retry(id: string, rotateQuarterTurns = 0) {
    const r = this.find(id);
    if (!r) return;
    this.rotate.set(id, ((this.rotate.get(id) ?? 0) + rotateQuarterTurns + 4) % 4);
    r.status = 'queued';
    r.progress = 0;
    r.message = undefined;
    this.save();
    void this.processQueue();
  }

  /** Clears the list and everything saved for it, ready for a new week. */
  async startOver() {
    if (this.removed) clearTimeout(this.removed.timer);
    this.removed = undefined;
    this.bundle = emptyBundle();
    this.sources.clear();
    this.selected.clear();
    this.reviewing = undefined;
    this.lastSaved = undefined;
    this.estimate = undefined;
    this.notice = undefined;
    delight.resetMilestones();
    await storage.clearAll();
  }

  // --- Processing ------------------------------------------------------------------

  async processQueue() {
    if (this.running) return;
    this.running = true;
    let processed = 0;
    try {
      for (;;) {
        const r = this.bundle.readings.find((x) => x.status === 'queued');
        if (!r) break;
        await this.processOne(r.id);
        processed++;
      }
    } finally {
      this.running = false;
      void this.refreshEstimate();
      void this.gc();
      if (processed && this.counts.done && !this.counts.waiting) delight.allReady();
    }
  }

  private async processOne(id: string) {
    const r = this.find(id);
    if (!r) return;
    let files = this.sources.get(id);
    if (!files) {
      files = await storage.getSources(id);
      if (files) this.sources.set(id, files);
    }
    if (!files?.length) {
      this.update(id, { status: 'error', message: 'The original file is no longer available. Remove this reading and add the file again.' });
      delight.readingFailed(id);
      return;
    }
    if (!r.sourceKey) r.sourceKey = await sourceKeyOf(files);
    const oldImages = [
      ...r.pages.map((p) => p.preview).filter((x): x is string => !!x),
      ...r.blocks.flatMap((b) => (b.kind === 'figure' ? [b.image] : [])),
    ];
    this.update(id, { status: 'processing', progress: 0, message: 'Starting' });
    this.current = id;
    try {
      const res = await processSources(files, r.fileType, {
        settings: $state.snapshot(this.bundle.settings) as BundleSettings,
        newId: uid,
        putImage: storage.putImage,
        rotate: this.rotate.get(id) ?? 0,
        onProgress: (progress, message) => {
          const cur = this.find(id);
          if (cur) {
            cur.progress = progress;
            cur.message = message;
          }
        },
      });
      const cur = this.find(id) ?? this.removed?.items.find((x) => x.reading.id === id)?.reading;
      if (!cur) return;
      const autoTitle = cur.title === titleFromFileName(files[0].name);
      Object.assign(cur, {
        status: 'done',
        progress: 1,
        message: undefined,
        pages: res.pages,
        blocks: res.blocks,
        notes: res.notes,
        ...(autoTitle && res.title ? { title: res.title } : {}),
        ...(!cur.author && res.author ? { author: res.author } : {}),
      });
      if (!res.blocks.length) {
        cur.status = 'error';
        cur.message = 'No text was found. If this is a photo, try rotating it or taking a sharper picture.';
      }
      await storage.deleteImages(oldImages);
      this.save();
      if (this.find(id)) cur.status === 'done' ? delight.readingDone(id) : delight.readingFailed(id);
    } catch (e) {
      console.error(e);
      this.update(id, { status: 'error', message: friendlyError(e) });
      delight.readingFailed(id);
    } finally {
      this.current = undefined;
    }
  }

  async refreshEstimate() {
    try {
      this.estimate = await estimateSize($state.snapshot(this.bundle) as Bundle);
    } catch {
      this.estimate = undefined;
    }
  }

  // --- Building ----------------------------------------------------------------------

  /** File name (without extension) to suggest when saving. */
  get suggestedFileName(): string {
    const s = this.bundle.settings;
    return s.fileName || epubFileName(s).replace(/\.(kepub\.)?epub$/, '');
  }

  get fileExtension(): string {
    return this.bundle.settings.kepub ? '.kepub.epub' : '.epub';
  }

  async build(fileName?: string): Promise<boolean> {
    if (this.building) return false;
    if (!this.counts.done) {
      this.flash('Add at least one reading first.');
      return false;
    }
    const base = fileName !== undefined ? safeFileBase(fileName) : '';
    if (base) this.updateSettings({ fileName: base });
    this.building = true;
    try {
      const res = await exportEpub($state.snapshot(this.bundle) as Bundle, base || undefined);
      if (!res) return false;
      this.lastSaved = res.fileName;
      this.flash(`Saved ${res.fileName} (${formatBytes(res.bytes)}).`);
      return true;
    } catch (e) {
      console.error(e);
      this.flash(`Couldn't build the EPUB: ${friendlyError(e)}`);
      return false;
    } finally {
      this.building = false;
    }
  }
}

function list(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/password/i.test(msg)) return 'This PDF is password-protected. Remove the password and add it again.';
  if (/Invalid PDF|bad XRef|FormatError/i.test(msg)) return "This PDF looks damaged and couldn't be read.";
  if (/central directory|zip/i.test(msg)) return "This Word file couldn't be opened. Try saving it again as .docx.";
  if (/fetch|network|Failed to load/i.test(msg)) return "Couldn't load the text-recognition engine. Check your internet connection and try again.";
  return msg || 'Something went wrong.';
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const app = new AppState();
