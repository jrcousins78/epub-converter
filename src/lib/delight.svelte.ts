// Small moments of feedback: drawn check marks, rare doodle surprises,
// milestone cards, a success burst, and (on Android) a very short vibration.
// Everything is skipped when the system asks for reduced motion or the
// user turns "Playful touches" off.

export type DoodleName =
  | 'star'
  | 'leaf'
  | 'bookworm'
  | 'plane'
  | 'bulb'
  | 'coffee'
  | 'stack'
  | 'shelf'
  | 'mountain'
  | 'library'
  | 'openbook';

/** Doodles that can appear (rarely) instead of the usual check mark. */
export const SURPRISES: DoodleName[] = ['star', 'leaf', 'bookworm', 'plane', 'bulb', 'coffee'];

export const MILESTONES: { count: number; doodle: DoodleName; text: string }[] = [
  { count: 10, doodle: 'stack', text: 'Ten readings. That’s a respectable stack.' },
  { count: 25, doodle: 'shelf', text: 'Twenty-five readings — a whole shelf.' },
  { count: 50, doodle: 'mountain', text: 'Fifty readings. Summit reached.' },
  { count: 100, doodle: 'library', text: 'A hundred readings. You basically run a library.' },
];

/** Milestones crossed when the list grows from `before` to `after` readings. */
export function crossedMilestones(before: number, after: number, seen: number[]): typeof MILESTONES {
  return MILESTONES.filter((m) => before < m.count && after >= m.count && !seen.includes(m.count));
}

/**
 * Picks the celebration for a finished reading: usually a check mark, now and
 * then a doodle, never two doodles in a row and never the same doodle twice running.
 */
export function pickCelebration(rand: () => number, last: Celebration | undefined, lastDoodle: DoodleName | undefined, p = 0.18): Celebration {
  if (last && last !== 'check') return 'check';
  if (rand() >= p) return 'check';
  const options = SURPRISES.filter((d) => d !== lastDoodle);
  return options[Math.floor(rand() * options.length) % options.length];
}

export type Celebration = 'check' | DoodleName;

export interface Effect {
  id: number;
  type: 'success' | 'card';
  x: number;
  y: number;
  doodle?: DoodleName;
  text?: string;
}

interface Prefs {
  playful: boolean;
  haptics: boolean;
}

const PREFS_KEY = 'epub-converter:prefs';
const SEEN_KEY = 'epub-converter:milestones';
const FIRST_BOOK_KEY = 'epub-converter:first-book';

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

class Delight {
  prefs = $state<Prefs>(readJson(PREFS_KEY, { playful: true, haptics: true }));
  /** Per-reading celebration currently showing (cleared after a moment). */
  celebrations = $state<Record<string, Celebration>>({});
  /** Readings that just failed (row gives a small shake). */
  shakes = $state<Record<string, number>>({});
  effects = $state<Effect[]>([]);
  /** Bumps when everything has finished processing (the build button pulses once). */
  readyPulse = $state(0);

  private nextId = 1;
  private lastCelebration: Celebration | undefined;
  private lastDoodle: DoodleName | undefined;

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    this.prefs[key] = value;
    writeJson(PREFS_KEY, $state.snapshot(this.prefs));
  }

  get reducedMotion(): boolean {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  get playful(): boolean {
    return this.prefs.playful && !this.reducedMotion;
  }

  /** A very short vibration (Android browsers only; iPhones ignore it). */
  tap(kind: 'light' | 'success' | 'error' = 'light') {
    if (!this.prefs.haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const pattern = kind === 'light' ? 8 : kind === 'success' ? [10, 60, 14] : [18, 50, 18];
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not allowed */
    }
  }

  readingDone(id: string) {
    const c = this.playful ? pickCelebration(Math.random, this.lastCelebration, this.lastDoodle) : 'check';
    this.lastCelebration = c;
    if (c !== 'check') this.lastDoodle = c;
    this.celebrations[id] = c;
    this.tap('light');
    setTimeout(() => {
      if (this.celebrations[id] === c) delete this.celebrations[id];
    }, c === 'check' ? 2200 : 3200);
  }

  readingFailed(id: string) {
    this.shakes[id] = (this.shakes[id] ?? 0) + 1;
    this.tap('error');
  }

  allReady() {
    this.readyPulse++;
  }

  readingsAdded(before: number, after: number) {
    this.tap('light');
    if (!this.playful) return;
    const seen = readJson<{ counts: number[] }>(SEEN_KEY, { counts: [] }).counts;
    const hit = crossedMilestones(before, after, seen).pop();
    if (!hit) return;
    writeJson(SEEN_KEY, { counts: [...seen, ...MILESTONES.filter((m) => m.count <= hit.count).map((m) => m.count)] });
    setTimeout(() => this.card(hit.doodle, hit.text), 500);
  }

  /** Clears milestone memory, e.g. when starting a new week. */
  resetMilestones() {
    writeJson(SEEN_KEY, { counts: [] });
  }

  built(origin: { x: number; y: number }) {
    this.tap('success');
    if (!this.playful) return;
    this.spawn({ type: 'success', ...origin }, 1200);
    let first = false;
    try {
      first = !localStorage.getItem(FIRST_BOOK_KEY);
      localStorage.setItem(FIRST_BOOK_KEY, '1');
    } catch {
      /* ignore */
    }
    if (first) setTimeout(() => this.card('openbook', 'Your first book is ready. Happy reading.'), 700);
  }

  card(doodle: DoodleName, text: string) {
    this.spawn({ type: 'card', x: 0, y: 0, doodle, text }, 4200);
  }

  dismiss(id: number) {
    this.effects = this.effects.filter((e) => e.id !== id);
  }

  private spawn(e: Omit<Effect, 'id'>, ms: number) {
    const id = this.nextId++;
    this.effects.push({ ...e, id });
    setTimeout(() => this.dismiss(id), ms);
  }
}

export const delight = new Delight();
