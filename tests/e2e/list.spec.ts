import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const fx = (f: string) => `tests/fixtures/${f}`;
const MIME: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg' };

/** Simulates dragging files from the desktop and dropping them on `selector` (the event bubbles like a real drop). */
async function dropFiles(page: Page, selector: string, paths: string[]) {
  const files = paths.map((p) => ({ name: basename(p), b64: readFileSync(p).toString('base64'), type: MIME[p.split('.').pop()!] }));
  const dt = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type, lastModified: 1_700_000_000_000 }));
    }
    return dt;
  }, files);
  await page.dispatchEvent(selector, 'dragenter', { dataTransfer: dt });
  await page.dispatchEvent(selector, 'dragover', { dataTransfer: dt });
  await page.dispatchEvent(selector, 'drop', { dataTransfer: dt });
}

test('dropping files adds each one once, and dropping them again does not duplicate them', async ({ page }) => {
  await page.goto('./');
  await dropFiles(page, '[data-testid="drop-zone"]', [fx('mill-text.pdf'), fx('mill-guide.docx')]);
  await expect(page.getByTestId('reading')).toHaveCount(2);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('reading')).toHaveCount(2);
  // Handled exactly once: no "already in the list" message for a single drop.
  await expect(page.getByText('Already in the list')).toHaveCount(0);

  // Same files again, on the drop zone and on the page itself.
  await dropFiles(page, '[data-testid="drop-zone"]', [fx('mill-text.pdf')]);
  await expect(page.getByRole('status')).toContainText('Already in the list: mill-text.pdf');
  await dropFiles(page, 'main', [fx('mill-guide.docx')]);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('reading')).toHaveCount(2);

  // The same file twice through the file picker is also skipped.
  await page.getByTestId('file-input').setInputFiles(fx('mill-text.pdf'));
  await page.waitForTimeout(300);
  await expect(page.getByTestId('reading')).toHaveCount(2);
});

test('select several readings, remove them together, and undo', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([fx('mill-text.pdf'), fx('mill-guide.docx'), fx('mill-scan.pdf')]);
  await expect(page.getByTestId('reading')).toHaveCount(3);

  // Click the first, shift-click the third: all three selected.
  const boxes = page.getByTestId('select');
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('footer')).toContainText('3 selected');

  // Set a course for all of them at once.
  await page.getByLabel('Set course for selected readings').fill('PHIL 210');
  await page.getByLabel('Set course for selected readings').press('Enter');
  for (let i = 0; i < 3; i++) await expect(page.getByLabel('Course').nth(i)).toHaveValue('PHIL 210');

  // Untick one, remove the other two.
  await boxes.nth(1).click();
  await expect(page.locator('footer')).toContainText('2 selected');
  await page.getByTestId('remove-selected').click();
  await expect(page.getByTestId('reading')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('Removed 2 readings');

  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('reading')).toHaveCount(3);

  // Select all, then Escape clears the selection.
  await page.getByTestId('select-all').check();
  await expect(page.locator('footer')).toContainText('3 selected');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('build')).toBeVisible();
});

test('start over after saving clears the list', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles(fx('mill-guide.docx'));
  await expect(page.getByTestId('summary')).toContainText('1 of 1 ready');
  await page.getByTestId('build').click();
  await Promise.all([page.waitForEvent('download'), page.getByTestId('save').click()]);
  await page.getByTestId('start-over').click();
  await page.getByTestId('confirm-reset').click();
  await expect(page.getByText('Drop your readings here')).toBeVisible();
  await expect(page.getByTestId('reading')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Drop your readings here')).toBeVisible();
});

test('a finished reading gets a small drawn check (or a rare doodle)', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles(fx('mill-text.pdf'));
  await expect(page.getByTestId('done-mark')).toBeVisible();
  await expect(page.getByTestId('done-mark').locator('svg')).toHaveAttribute('role', 'img');
});
