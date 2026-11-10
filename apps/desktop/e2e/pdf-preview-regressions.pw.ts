import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { continuousPdf } from './continuous-pdf-fixture';

const PREVIEW_URL = 'http://127.0.0.1:49171/preview/report.PDF';
const LONG_TITLE = 'A detailed overview of the experimental evaluation and extended related work';

async function applyDesktopPolicy(page: Page) {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
    app: { security: { csp: Record<string, string> } };
  };
  await page.route('**/e2e/reply-resources-harness.html?**', async route => {
    const response = await route.fetch();
    // Enforce the production connection policy while allowing Vite's development scripts.
    await route.fulfill({ response, headers: { ...response.headers(),
      'Content-Security-Policy': `connect-src ${config.app.security.csp['connect-src']}` } });
  });
}

async function showOutline(pdf: Locator) {
  const toggle = pdf.getByRole('button', { name: 'PDF 导航', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await pdf.getByRole('button', { name: '目录大纲', exact: true }).click();
}

for (const dark of [false, true]) {
  test(`local: direct PDF preview respects desktop policy (${dark ? 'dark narrow font20' : 'light wide'})`,
    async ({ page }, info) => {
      const bytes = process.env.PDF_PREVIEW_FIXTURE
        ? await readFile(process.env.PDF_PREVIEW_FIXTURE) : continuousPdf();
      const violations: string[] = [];
      page.on('console', message => { if (message.text().includes('connect-src')) violations.push(message.text()); });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/resource/report.PDF', route => route.fulfill({
        contentType: 'application/pdf', body: bytes,
      }));
      await page.route(PREVIEW_URL, route => route.fulfill({ contentType: 'application/pdf', body: bytes,
        headers: { 'Access-Control-Allow-Origin': '*' } }));
      await applyDesktopPolicy(page);
      if (dark) {
        await page.setViewportSize({ width: 980, height: 800 });
        await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
      }
      const query = new URLSearchParams({ mode: 'local', previewUrl: PREVIEW_URL });
      if (dark) query.set('dark', '1');
      await page.goto(`e2e/reply-resources-harness.html?${query}`);
      await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
      const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
      await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
      expect(await pdf.locator('.file-pdf-page').count()).toBeGreaterThan(1);
      expect(violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`local-${dark ? 'dark-narrow' : 'light-wide'}-direct-preview.png`) });
    });
}

test('remote: binary fallback remains readable with the desktop connection policy', async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/resource/report.PDF', route => route.fulfill({
    contentType: 'application/pdf', body: continuousPdf(),
  }));
  await applyDesktopPolicy(page);
  await page.goto('e2e/reply-resources-harness.html?mode=remote&previewUnavailable=1');
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  await expect(page.locator('.pm-browser-page:not([hidden]) .file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
});

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode}: long outline titles align with the disclosure arrow (${dark ? 'dark narrow font20' : 'light wide'})`,
      async ({ page }, info) => {
        await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
        await page.route('**/resource/report.PDF', route => route.fulfill({
          contentType: 'application/pdf', body: continuousPdf(LONG_TITLE),
        }));
        if (dark) {
          await page.setViewportSize({ width: 980, height: 800 });
          await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
        }
        await page.goto(`e2e/reply-resources-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
        await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
        if (!dark) await page.getByRole('button', { name: '展开详情抽屉', exact: true }).click();
        const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
        await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
        await showOutline(pdf);
        const title = pdf.getByRole('button', { name: LONG_TITLE, exact: true });
        await expect(title).toBeVisible();
        const summary = pdf.locator('summary').filter({ hasText: LONG_TITLE });
        const bounds = (await summary.boundingBox())!;
        const button = (await title.boundingBox())!;
        expect(button.y - bounds.y).toBeLessThan(8);
        expect(button.x).toBeGreaterThan(bounds.x + 8);
        expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
        expect(await pdf.locator('.file-pdf-outline').evaluate(element => element.scrollWidth - element.clientWidth))
          .toBeLessThan(2);
        await summary.press('Space');
        await expect(pdf.getByRole('button', { name: 'Nested results', exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-outline-wrap.png`) });
        await title.click();
        await expect(pdf.locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '7');
      });
  }
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: supplied PDF opens directly and aligns its original outline`, async ({ page }, info) => {
    test.skip(!process.env.PDF_PREVIEW_FIXTURE, 'Set PDF_PREVIEW_FIXTURE to verify a local PDF.');
    const bytes = await readFile(process.env.PDF_PREVIEW_FIXTURE!);
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.route('**/resource/report.PDF', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
    await page.goto(`e2e/reply-resources-harness.html?mode=${mode}`);
    await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
    await page.getByRole('button', { name: '展开详情抽屉', exact: true }).click();
    const pdf = page.locator('.pm-browser-page:not([hidden]) .file-pdf-preview');
    await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
    await showOutline(pdf);
    const title = pdf.getByRole('button', { name: 'Additional Experiments', exact: true });
    await expect(title).toBeVisible();
    for (const summary of await pdf.locator('summary').all()) {
      if (!await summary.isVisible()) continue;
      expect((await summary.locator('button').boundingBox())!.y - (await summary.boundingBox())!.y).toBeLessThan(8);
    }
    await title.click();
    await expect(title).toHaveAttribute('aria-current', 'location');
    await page.screenshot({ path: info.outputPath(`${mode}-supplied-pdf-outline.png`) });
  });
}
