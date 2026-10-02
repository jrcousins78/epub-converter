// App state: the current weekly bundle, the processing queue and autosave.
import { defaultSettings, type Block, type Bundle, type BundleSettings, type Reading } from './model';
import { uid } from './util/id';
import { kindOf, processSources, titleFromFileName, type SourceKind } from './pipeline';
import * as storage from './storage';
import { exportEpub, estimateSize } from './export';

function emptyBundle(): Bundle {
  const now = Date.now();
  return { id: uid(), settings: defaultSettings(), readings: [], createdAt: now, updatedAt: now };
}

class AppState {
  bundle = $state<Bundle>(emptyBundle());
  loaded = $state(false);
  building = $state(false);
  notice = $state<string | undefined>(undefined);
  estimate = $state<number | undefined>(undefined);
  reviewing = $state<string | undefined>(undefined);

  private sources = new Map<string, File[]>();
  private running = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private rotate = new Map<string, number>();

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

  flash(message: string) {
    this.notice = message;
    setTimeout(() => {
      if (this.notice === message) this.notice = undefined;
    }, 6000);
  }

  updateSettings(patch: Partial<BundleSettings>) {
    Object.assign(this.bundle.settings, patch);
    this.save();
  }

  /** PDFs and Word files become one reading each; photos dropped together become one reading. */
  async addFiles(files: File[]) {
    const photos: File[] = [];
    const skipped: string[] = [];
    const added: Reading[] = [];
    const lastCourse = this.bundle.readings[this.bundle.readings.length - 1]?.course ?? '';
    const make = (fs: File[], kind: SourceKind, title: string): Reading => ({
      id: uid(),
      title,
      author: '',
      course: lastCourse,
      fileName: fs.length > 1 ? `${fs.length} photos` : fs[0].name,
      fileType: kind,
      status: 'queued',
      progress: 0,
      pages: [],
      blocks: [],
      notes: [],
    });
    for (const f of files) {
      const kind = kindOf(f);
      if (!kind) skipped.push(f.name);
      else if (kind === 'image') photos.push(f);
      else {
        const r = make([f], kind, titleFromFileName(f.name));
        this.sources.set(r.id, [f]);
        added.push(r);
      }
    }
    if (photos.length) {
      photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const r = make(photos, 'image', titleFromFileName(photos[0].name));
      this.sources.set(r.id, photos);
      added.push(r);
    }
    if (skipped.length) this.flash(`Skipped ${skipped.length} file${skipped.length > 1 ? 's' : ''} that aren't PDFs, photos or Word documents: ${skipped.join(', ')}`);
    if (!added.length) return;
    this.bundle.readings.push(...added);
    this.save();
    void storage.requestPersistence();
    for (const r of added) void storage.putSources(r.id, this.sources.get(r.id)!).catch(() => undefined);
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

  remove(id: string) {
    this.bundle.readings = this.bundle.readings.filter((r) => r.id !== id);
    this.sources.delete(id);
    if (this.reviewing === id) this.reviewing = undefined;
    this.save();
    void storage.collectGarbage($state.snapshot(this.bundle) as Bundle);
    void this.refreshEstimate();
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

  async clearAll() {
    this.bundle = emptyBundle();
    this.sources.clear();
    this.reviewing = undefined;
    await storage.clearAll();
    this.estimate = undefined;
  }

  async processQueue() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const r = this.bundle.readings.find((x) => x.status === 'queued');
        if (!r) break;
        await this.processOne(r.id);
      }
    } finally {
      this.running = false;
      void this.refreshEstimate();
      void storage.collectGarbage($state.snapshot(this.bundle) as Bundle);
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
      return;
    }
    const oldImages = [
      ...r.pages.map((p) => p.preview).filter((x): x is string => !!x),
      ...r.blocks.flatMap((b) => (b.kind === 'figure' ? [b.image] : [])),
    ];
    this.update(id, { status: 'processing', progress: 0, message: 'Starting' });
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
      const cur = this.find(id);
      if (!cur) return; // removed while processing
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
    } catch (e) {
      console.error(e);
      this.update(id, { status: 'error', message: friendlyError(e) });
    }
  }

  async refreshEstimate() {
    try {
      this.estimate = await estimateSize($state.snapshot(this.bundle) as Bundle);
    } catch {
      this.estimate = undefined;
    }
  }

  async build() {
    if (this.building) return;
    if (!this.counts.done) {
      this.flash('Add at least one reading first.');
      return;
    }
    this.building = true;
    try {
      const res = await exportEpub($state.snapshot(this.bundle) as Bundle);
      if (res) this.flash(`Saved ${res.fileName} (${formatBytes(res.bytes)}).`);
    } catch (e) {
      console.error(e);
      this.flash(`Couldn't build the EPUB: ${friendlyError(e)}`);
    } finally {
      this.building = false;
    }
  }
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
