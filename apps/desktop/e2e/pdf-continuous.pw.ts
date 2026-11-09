import { expect, test, type Locator, type Page } from '@playwright/test';
import { continuousPdf, PDF_FIXTURE_PAGES } from './continuous-pdf-fixture';
import { samplePdf } from './preview-samples';

async function openPdf(page: Page, mode: string, dark: boolean, outline = true) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/resource/report.PDF', route => route.fulfill({
    contentType: 'application/pdf', body: outline ? continuousPdf() : samplePdf(),
  }));
  if (dark) {
    await page.setViewportSize({ width: 980, height: 800 });
    await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
  }
  await page.goto(`e2e/reply-resources-harness.html?mode=${mode}&pdfRouting=1${dark ? '&dark=1' : ''}`);
  await page.getByRole('button', { name: '默认入口 PDF', exact: true }).click();
  if (!dark) await page.getByRole('button', { name: '展开详情抽屉', exact: true }).click();
  const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
  await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
  await expect(pdf.locator('.file-pdf-page')).toHaveCount(outline ? PDF_FIXTURE_PAGES : 2);
  return pdf;
}

async function expectPage(pdf: Locator, number: number) {
  await expect(pdf.locator('.file-pdf-pages')).toHaveAttribute('data-current-page', String(number));
  await expect(pdf.getByRole('textbox', { name: '页码', exact: true })).toHaveValue(String(number));
  await expect(pdf.locator(`.file-pdf-page[data-pdf-page="${number}"] canvas`)).toBeVisible();
}

async function showSidebar(pdf: Locator) {
  const toggle = pdf.getByRole('button', { name: 'PDF 导航', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(pdf.locator('.file-pdf-sidebar')).toBeVisible();
}

async function checkScrollAndZoom(page: Page, pdf: Locator) {
  const pages = pdf.locator('.file-pdf-pages');
  await pages.evaluate(element => {
    const target = element.querySelector<HTMLElement>('[data-pdf-page="3"]')!;
    element.scrollTop = target.offsetTop;
  });
  await expectPage(pdf, 3);
  const before = await pdf.locator('.file-pdf-page[data-pdf-page="3"] canvas').boundingBox();
  await pdf.getByRole('button', { name: '放大', exact: true }).click();
  await expectPage(pdf, 3);
  await expect.poll(async () => (await pdf.locator('.file-pdf-page[data-pdf-page="3"] canvas').boundingBox())!.width)
    .toBeGreaterThan(before!.width);
  const jump = pdf.getByRole('textbox', { name: '页码', exact: true });
  await jump.fill('20'); await jump.press('Enter');
  await expectPage(pdf, 20);
  await expect.poll(() => pages.locator('canvas').count()).toBeLessThan(8);
  await expect(pages.locator('[data-pdf-page="1"] canvas')).toHaveCount(0);
  await jump.fill('999'); await jump.press('Enter');
  await expectPage(pdf, 20);
  expect(page.context().pages()).toHaveLength(1);
}

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode}: ${dark ? 'dark narrow font20' : 'light wide'} continuous pages, thumbnails and outline`,
      async ({ page }, info) => {
        const pdf = await openPdf(page, mode, dark);
        await checkScrollAndZoom(page, pdf);
        await showSidebar(pdf);
        for (const label of ['页面缩略图', '目录大纲']) {
          const control = pdf.getByRole('button', { name: label, exact: true });
          await expect(control).toHaveText('');
          await expect(control).toHaveAttribute('title', label);
        }
        await expect(pdf.locator('[data-thumbnail-page="20"]')).toHaveAttribute('aria-current', 'page');
        await expect(pdf.locator('[data-thumbnail-page="20"] canvas')).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark' : 'light'}-thumbnails.png`) });
        await pdf.getByRole('button', { name: '第 6 页', exact: true }).click();
        await expectPage(pdf, 6);
        await showSidebar(pdf);
        await pdf.getByRole('button', { name: '目录大纲', exact: true }).click();
        await pdf.getByRole('button', { name: 'Methods', exact: true }).click();
        await expectPage(pdf, 7);
        await showSidebar(pdf);
        await pdf.locator('summary').filter({ hasText: 'Methods' }).press('Space');
        await pdf.getByRole('button', { name: 'Nested results', exact: true }).click();
        await expectPage(pdf, 15);
        await showSidebar(pdf);
        await expect(pdf.getByRole('button', { name: 'External link', exact: true })).toBeDisabled();
        await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark' : 'light'}-outline.png`) });
      });
  }
}

test('PDFs without bookmarks show a clear empty outline', async ({ page }, info) => {
  const pdf = await openPdf(page, 'local', false, false);
  await showSidebar(pdf);
  await pdf.getByRole('button', { name: '目录大纲', exact: true }).click();
  await expect(pdf.getByText('此 PDF 没有目录大纲。', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('local-empty-outline.png') });
});

test('reader labels switch language while retaining the current page', async ({ page }) => {
  const pdf = await openPdf(page, 'web', false);
  await showSidebar(pdf);
  for (const [language, thumbnails, outline] of [
    ['en', 'Page thumbnails', 'Outline'], ['ru', 'Миниатюры страниц', 'Оглавление'], ['ja', 'ページ一覧', '目次'],
  ]) {
    await page.evaluate(language => (window as unknown as { setPreviewLanguage: (value: string) => void })
      .setPreviewLanguage(language), language);
    await expect(pdf.getByRole('button', { name: thumbnails, exact: true })).toBeVisible();
    await expect(pdf.getByRole('button', { name: outline, exact: true })).toBeVisible();
    await expect(pdf.locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '1');
  }
});
