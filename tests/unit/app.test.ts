import { describe, expect, it } from 'vitest';
import { crossedMilestones, pickCelebration, SURPRISES } from '../../src/lib/delight.svelte';
import { findDuplicates, fingerprint, sourceKeyOf } from '../../src/lib/app.svelte';
import { epubFileName, safeFileBase } from '../../src/lib/epub/build';
import { defaultSettings, type Reading } from '../../src/lib/model';

const r = (id: string, over: Partial<Reading> = {}): Reading => ({
  id,
  title: id,
  author: '',
  course: '',
  fileName: 'a.pdf',
  fileType: 'pdf',
  status: 'done',
  progress: 1,
  pages: [{ label: '1', source: 'text' }],
  blocks: [],
  notes: [],
  ...over,
});

describe('duplicates', () => {
  it('flags later copies of the same source file', async () => {
    const k = await sourceKeyOf([new File(['x'], 'a.pdf', { lastModified: 1 })]);
    expect(findDuplicates([r('1', { sourceKey: k }), r('2', { sourceKey: k }), r('3', { sourceKey: 'other' })])).toEqual(['2']);
  });

  it('falls back to name, type and page count for readings saved before source keys existed', () => {
    expect(findDuplicates([r('1'), r('2'), r('3', { fileName: 'b.pdf' })])).toEqual(['2']);
  });

  it('treats photo sets as one source regardless of order', async () => {
    const a = new File(['1'], 'p1.jpg', { lastModified: 1 });
    const b = new File(['2'], 'p2.jpg', { lastModified: 2 });
    expect(await sourceKeyOf([a, b])).toBe(await sourceKeyOf([b, a]));
  });

  it('recognises the same contents under a different name or date', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 251);
    const a = new File([bytes], 'reading.pdf', { lastModified: 1 });
    const b = new File([bytes], 'reading (1).pdf', { lastModified: 99 });
    const c = new File([bytes.map((x, i) => (i === 100_000 ? x ^ 1 : x))], 'reading.pdf', { lastModified: 1 });
    expect(await fingerprint(a)).toBe(await fingerprint(b));
    expect(await fingerprint(a)).not.toBe(await fingerprint(new File([bytes.slice(1)], 'x')));
    // Only the start and end are checked, so a change in the middle is not detected; size matters though.
    expect(await fingerprint(c)).toBe(await fingerprint(a));
  });
});

describe('file names', () => {
  it('cleans user-chosen names and adds the right extension', () => {
    const s = defaultSettings();
    expect(epubFileName(s, 'Week 5: Mill / Weber?')).toBe('Week 5 Mill Weber.epub');
    expect(epubFileName({ ...s, kepub: true }, 'Week 5.epub')).toBe('Week 5.kepub.epub');
    expect(epubFileName(s, '   ')).toBe('Weekly-readings.epub');
    expect(safeFileBase('..hidden.')).toBe('hidden');
    expect(safeFileBase('SOC 101 – Week 1 “Mill” café')).toBe('SOC 101 - Week 1 Mill cafe');
  });
});

describe('delight', () => {
  it('celebrates milestones once, when the list crosses them', () => {
    expect(crossedMilestones(8, 11, []).map((m) => m.count)).toEqual([10]);
    expect(crossedMilestones(8, 30, []).map((m) => m.count)).toEqual([10, 25]);
    expect(crossedMilestones(8, 11, [10])).toEqual([]);
    expect(crossedMilestones(10, 12, [])).toEqual([]);
  });

  it('usually shows a check, sometimes a doodle, never two doodles in a row', () => {
    const always = () => 0; // forces the rare branch
    const first = pickCelebration(always, 'check', undefined);
    expect(SURPRISES).toContain(first);
    expect(pickCelebration(always, first, first as never)).toBe('check');
    expect(pickCelebration(() => 0.99, 'check', undefined)).toBe('check');
    // Never the same doodle twice running.
    const seq = [0, 0.99, 0];
    let k = 0;
    const next = pickCelebration(() => seq[k++ % seq.length], 'check', 'star');
    expect(next).not.toBe('star');
  });

  it('shows surprises at roughly the intended rate', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let last: ReturnType<typeof pickCelebration> | undefined;
    let doodles = 0;
    for (let i = 0; i < 2000; i++) {
      last = pickCelebration(rand, last, undefined);
      if (last !== 'check') doodles++;
    }
    expect(doodles / 2000).toBeGreaterThan(0.1);
    expect(doodles / 2000).toBeLessThan(0.2);
  });
});
