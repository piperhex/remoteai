import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { samplePdf } from './preview-samples';

async function changeLimit(page: Page, limit: number) {
  await page.evaluate(value => (window as unknown as { setPdfPolicy: (value: number) => void }).setPdfPolicy(value), limit);
}

for (const mode of ['remote', 'web']) {
  for (const narrow of [false, true]) {
    test(`${mode}: Admin PDF limits update live (${narrow ? 'mobile' : 'desktop'})`, async ({ page }, info) => {
      if (narrow) await page.setViewportSize({ width: 412, height: 850 });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/resource/report.PDF', route => route.fulfill({
        contentType: 'application/pdf', body: samplePdf(3 * 1024 * 1024),
      }));
      await page.goto(`e2e/reply-resources-harness.html?mode=${mode}&pdfLimit=1`);
      await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
      const active = page.locator('.pm-browser-page:not([hidden])');
      await expect(active.getByRole('status')).toContainText('暂时无法预览');
      await expect(active.locator('.file-pdf-preview')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${mode}-${narrow ? 'mobile' : 'desktop'}-limit-1mb.png`) });
      await changeLimit(page, 100);
      await expect(active.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${narrow ? 'mobile' : 'desktop'}-limit-100mb.png`) });
      await changeLimit(page, 1);
      await expect(active.getByRole('status')).toContainText('暂时无法预览');
      await expect(active.locator('.file-pdf-preview')).toHaveCount(0);
      await expect(page.locator('body')).toHaveAttribute('data-transfers', '0');
    });
  }
}

test('local: local PDFs retain unrestricted viewing independently of remote Admin settings', async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/resource/report.PDF', route => route.fulfill({
    contentType: 'application/pdf', body: samplePdf(3 * 1024 * 1024),
  }));
  await page.goto('e2e/reply-resources-harness.html?mode=local&pdfLimit=1');
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  await expect(page.locator('.pm-browser-page:not([hidden]) .file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
});

test('web: supplied PDF opens in mobile preview with continuous pages and its outline', async ({ page }, info) => {
  test.skip(!process.env.PDF_PREVIEW_FIXTURE, 'Set PDF_PREVIEW_FIXTURE to verify a local PDF.');
  const bytes = await readFile(process.env.PDF_PREVIEW_FIXTURE!);
  await page.setViewportSize({ width: 412, height: 850 });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/resource/report.PDF', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  await page.goto('e2e/reply-resources-harness.html?mode=web&pdfLimit=1');
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  const active = page.locator('.pm-browser-page:not([hidden])');
  await expect(active.getByRole('status')).toContainText('暂时无法预览');
  await changeLimit(page, 100);
  const pdf = active.locator('.file-pdf-preview');
  await expect(pdf.locator('.file-pdf-page')).toHaveCount(28);
  await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
  await page.screenshot({ path: info.outputPath('web-mobile-supplied-pdf-first-page.png') });
  await pdf.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(pdf.locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '2');
  await expect(pdf.locator('.file-pdf-page[data-pdf-page="2"] canvas')).toBeVisible();
  await pdf.getByRole('button', { name: 'PDF 导航', exact: true }).click();
  await pdf.getByRole('button', { name: '目录大纲', exact: true }).click();
  await expect(pdf.getByRole('button', { name: 'Additional Experiments', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('web-mobile-supplied-pdf-outline.png') });
  await pdf.getByRole('button', { name: 'Additional Experiments', exact: true }).click();
  await expect.poll(() => pdf.locator('.file-pdf-pages').evaluate(element => {
    const target = element.querySelector('.file-pdf-page[data-pdf-page="15"]')!.getBoundingClientRect();
    const top = element.getBoundingClientRect().top;
    return target.top <= top + 16 && target.bottom > top + 16;
  })).toBe(true);
  await expect(pdf.locator('.file-pdf-page[data-pdf-page="15"] canvas')).toBeVisible();
  await page.screenshot({ path: info.outputPath('web-mobile-supplied-pdf-page-15.png') });
});
