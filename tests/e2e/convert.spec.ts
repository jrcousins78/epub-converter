import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';

const fx = (f: string) => `tests/fixtures/${f}`;

/** Text of all XHTML files of one reading, tags stripped. */
async function readingText(zip: JSZip, prefix: string): Promise<string> {
  const names = Object.keys(zip.files).filter((n) => n.startsWith(`OEBPS/text/${prefix}`)).sort();
  let s = '';
  for (const n of names) s += ' ' + (await zip.file(n)!.async('string'));
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const GROUND_TRUTH = readFileSync('scripts/make-fixtures.mjs', 'utf8')
  .match(/'([^']{120,})'/g)!
  .map((s) => s.slice(1, -1).replace('^1', ''))
  .join(' ');

function wordRecall(ocr: string, truth: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const have = new Set(norm(ocr));
  const want = norm(truth.slice(0, 1400));
  return want.filter((w) => have.has(w)).length / want.length;
}

test('converts a week of mixed readings into one valid EPUB', async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('browser error:', m.text());
  });
  await page.goto('./');
  await expect(page.getByText('Drop your readings here')).toBeVisible();

  await page.getByLabel('Book title').fill('SOC 101 – Week 1');
  await page.getByLabel('Book title').press('Tab');
  await page.getByLabel('Book author').fill('SOC 101');
  await page.getByLabel('Book author').press('Tab');

  const input = page.getByTestId('file-input');
  await input.setInputFiles(fx('mill-text.pdf'));
  await input.setInputFiles(fx('mill-guide.docx'));
  await input.setInputFiles(fx('mill-scan.pdf'));
  await input.setInputFiles(fx('mill-photo-spread.jpg'));

  await expect(page.getByTestId('reading')).toHaveCount(4);
  await expect(page.getByTestId('summary')).toContainText('4 of 4 ready', { timeout: 8 * 60_000 });

  // Titles come from PDF metadata / the Word title.
  await expect(page.getByLabel('Reading title').nth(0)).toHaveValue('On Liberty – Chapter II');
  await expect(page.getByLabel('Reading title').nth(1)).toHaveValue('Reading Guide: Mill on Free Expression');

  // Rename the photo reading and move it to the top.
  await page.getByLabel('Reading title').nth(3).fill('Mill, photos of pp. 21–22');
  await page.getByLabel('Reading title').nth(3).press('Tab');

  // The review screen opens and shows the scanned pages.
  await page.getByRole('button', { name: 'Review' }).nth(2).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Page 21/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Build: the save dialog suggests a name, which can be changed.
  await page.getByTestId('build').click();
  await expect(page.getByTestId('file-name')).toHaveValue('SOC-101-Week-1');
  await page.getByTestId('file-name').fill('SOC 101 – Week 1 (Mill)');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save').click()]);
  expect(download.suggestedFilename()).toBe('SOC 101 - Week 1 (Mill).epub');
  await expect(page.getByTestId('summary')).toContainText('Saved SOC 101 - Week 1 (Mill).epub');
  mkdirSync('test-results/epubs', { recursive: true });
  const path = 'test-results/epubs/e2e-week.epub';
  await download.saveAs(path);

  const zip = await JSZip.loadAsync(readFileSync(path));
  expect(Object.keys(zip.files)[0]).toBe('mimetype');
  const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
  for (const t of ['On Liberty – Chapter II', 'Reading Guide: Mill on Free Expression', 'Mill, photos of pp. 21–22', 'Questions to consider']) {
    expect(nav).toContain(t);
  }

  // Text PDF: headers removed, hyphenation fixed, page markers, footnote linked.
  const text = await readingText(zip, 'r01-');
  expect(text).toContain('[p. 21]');
  expect(text).toContain('[p. 22]');
  expect(text).toContain('not identified in interest');
  expect(text).toContain('We can [p. 22] never be sure');
  expect(text).not.toContain('OF THOUGHT AND DISCUSSION');
  const r1 = await zip.file('OEBPS/text/r01-01.xhtml')!.async('string');
  expect(r1).toContain('epub:type="noteref"');
  const notes = await zip.file('OEBPS/text/r01-notes.xhtml')!.async('string');
  expect(notes).toContain('These words were written in 1858');

  // Word file: footnote and italics survive.
  const guide = await zip.file('OEBPS/text/r02-01.xhtml')!.async('string');
  expect(guide).toContain('<i>On Liberty</i>');
  expect(zip.file('OEBPS/text/r02-notes.xhtml')).not.toBeNull();

  // OCR quality on the degraded scan and the phone photo.
  const scan = await readingText(zip, 'r03-');
  const photo = await readingText(zip, 'r04-');
  const scanRecall = wordRecall(scan, GROUND_TRUTH);
  const photoRecall = wordRecall(photo, GROUND_TRUTH);
  console.log(`OCR word recall — scanned PDF: ${(scanRecall * 100).toFixed(1)}%, phone photo: ${(photoRecall * 100).toFixed(1)}%`);
  writeFileSync('test-results/ocr-scan.txt', scan);
  writeFileSync('test-results/ocr-photo.txt', photo);
  expect(scanRecall).toBeGreaterThan(0.9);
  expect(photoRecall).toBeGreaterThan(0.85);
  expect(scan).toContain('[p. 21]');
});

test('keeps work after a reload', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles(fx('mill-text.pdf'));
  await expect(page.getByTestId('summary')).toContainText('1 of 1 ready');
  await page.waitForTimeout(800); // autosave debounce
  await page.reload();
  await expect(page.getByLabel('Reading title').first()).toHaveValue('On Liberty – Chapter II');
});
