import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { continuousPdf } from './continuous-pdf-fixture';
import { pinchPdf, pdfFocusError, swipePdf } from '../../native/e2e/pdf-touch.mjs';

for (const mode of ['remote', 'web']) {
  test(`${mode}: mobile PDF supports pinch, anchored zoom and one-finger panning`, async ({ page }, info) => {
    const bytes = process.env.PDF_PREVIEW_FIXTURE ? await readFile(process.env.PDF_PREVIEW_FIXTURE) : continuousPdf();
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.route('**/resource/report.PDF', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
    await page.goto(`e2e/reply-resources-harness.html?mode=${mode}&pdfLimit=100&mobile=1`);
    await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
    const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
    const pages = pdf.locator('.file-pdf-pages');
    await expect(pages.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
    const input = pdf.getByRole('textbox', { name: '页码', exact: true });
    await input.fill('6'); await input.press('Enter');
    await expect(pages.locator('.file-pdf-page[data-pdf-page="6"] canvas')).toBeVisible();
    const focus = await pinchPdf(page, pages, { dx: 15, dy: 20 });
    expect(focus.liveWidth / focus.width).toBeGreaterThan(1.5);
    await expect.poll(() => pdfFocusError(pages, focus)).toBeLessThan(3);
    await expect.poll(() => pages.locator('.file-pdf-page[data-pdf-page="6"]').evaluate(
      element => element.getBoundingClientRect().width)).toBeGreaterThan(focus.width * 1.5);
    await expect(pages.locator('.file-pdf-page[data-pdf-page="6"] canvas')).toBeVisible();
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await page.screenshot({ path: info.outputPath(`${mode}-mobile-original-pinched.png`) });
    const before = await pages.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
    await swipePdf(page, pages);
    await expect.poll(() => pages.evaluate(element => element.scrollTop)).toBeGreaterThan(before.top + 30);
    await swipePdf(page, pages, { dx: -100, dy: 0 });
    await expect.poll(() => pages.evaluate(element => element.scrollLeft)).toBeGreaterThan(before.left + 20);
    await page.waitForTimeout(350);
    const smaller = await pinchPdf(page, pages, { from: 190, to: 110 });
    expect(smaller.liveWidth).toBeLessThan(smaller.width * .7);
    await expect.poll(() => pdfFocusError(pages, smaller)).toBeLessThan(3);
    await expect(pages.locator('.file-pdf-page-list')).toHaveCSS('transform', 'none');
  });
}

test('mobile PDF cancels an interrupted pinch and retains the zoom bounds', async ({ page }) => {
  await page.route('**/resource/report.PDF', route => route.fulfill({ contentType: 'application/pdf', body: continuousPdf() }));
  await page.goto('e2e/reply-resources-harness.html?mode=web&pdfLimit=100&mobile=1');
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
  const pages = pdf.locator('.file-pdf-pages');
  const first = pages.locator('.file-pdf-page[data-pdf-page="1"]');
  await expect(first.locator('canvas')).toBeVisible();
  const base = (await first.boundingBox())!.width;
  await pinchPdf(page, pages, { cancel: true });
  await expect(pages.locator('.file-pdf-page-list')).toHaveCSS('transform', 'none');
  expect((await first.boundingBox())!.width).toBeCloseTo(base, 0);
  await pinchPdf(page, pages, { from: 50, to: 300 });
  await expect.poll(async () => (await first.boundingBox())!.width / base).toBeCloseTo(3, 1);
  await pinchPdf(page, pages, { from: 300, to: 40 });
  await expect.poll(async () => (await first.boundingBox())!.width / base).toBeCloseTo(.5, 1);
});
