import { expect, test, type Page } from '@playwright/test';
import { samplePdf } from './preview-samples';

async function fixture(page: Page, options: {
  mode: string; dark?: boolean; legacy?: boolean; unavailable?: boolean; standalone?: boolean;
}) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/resource/report.PDF', route => route.fulfill({
    contentType: 'application/pdf', body: samplePdf(),
  }));
  if (options.dark) {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
  }
  const query = new URLSearchParams({ mode: options.mode, pdfRouting: '1' });
  if (options.dark) query.set('dark', '1');
  if (options.legacy) query.set('legacy', '1');
  if (options.unavailable) query.set('previewUnavailable', '1');
  if (options.standalone) query.set('standalone', '1');
  await page.goto(`e2e/reply-resources-harness.html?${query}`);
}

async function expectPdfBrowser(page: Page) {
  const browser = page.locator('.website-preview-browser, .pm-browser[role="dialog"]');
  const active = browser.locator('.pm-browser-page:not([hidden])');
  await expect(browser.getByRole('tab', { selected: true })).toContainText('report.PDF');
  await expect(active.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
  await expect(active.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
  await expect(page.locator('body')).not.toHaveAttribute('data-text-read');
  await expect(page.locator('body')).not.toHaveAttribute('data-action');
  await expect(page.locator('body')).toHaveAttribute('data-transfers', '0');
  expect(page.context().pages()).toHaveLength(1);
  return { browser, active };
}

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    const label = `${mode} ${dark ? 'dark narrow font20' : 'light wide'} PDF entries use the built-in browser`;
    test(label, async ({ page }, info) => {
      await fixture(page, { mode, dark });
      const entries = ['默认入口 PDF', '备用文件入口 PDF', ...(mode === 'local' ? [] : ['备用远程入口 PDF']), 'report.PDF'];
      for (const entry of entries) {
        await page.locator('main').getByRole('button').filter({ hasText: entry }).click();
        const { browser } = await expectPdfBrowser(page);
        await expect(browser.getByRole('tab')).toHaveCount(1);
        await browser.getByRole('button', { name: '关闭 report.PDF', exact: true }).click();
      }
      await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
      const { browser, active } = await expectPdfBrowser(page);
      await active.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(active.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
      await expect(active.locator('.file-pdf-page[data-pdf-page="2"] canvas')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow-font20' : 'light-wide'}-pdf.png`) });
      await browser.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(active.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
      await expect(active.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
      await page.getByRole('button', { name: '切换会话', exact: true }).click();
      await expect(browser).toHaveCount(0);
    });
  }
}

for (const mode of ['remote', 'web']) {
  test(`${mode} legacy remote PDF fallback still opens the built-in browser`, async ({ page }, info) => {
    await fixture(page, { mode, legacy: true });
    await page.getByRole('button', { name: '备用远程入口 PDF', exact: true }).click();
    const { browser } = await expectPdfBrowser(page);
    await page.screenshot({ path: info.outputPath(`${mode}-legacy-pdf.png`) });
    await browser.getByRole('button', { name: '关闭 report.PDF', exact: true }).click();
    await expect(browser).toBeHidden();
    await page.getByRole('button', { name: '备用远程入口 PDF', exact: true }).click();
    await expectPdfBrowser(page);
  });
}

test('remote preview tunnel failure keeps PDF on the binary browser path', async ({ page }, info) => {
  await fixture(page, { mode: 'remote', unavailable: true, dark: true });
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  await expectPdfBrowser(page);
  await expect(page.locator('body')).toHaveAttribute('data-preview-reads', '1');
  await page.screenshot({ path: info.outputPath('remote-tunnel-fallback-pdf.png') });
});

test('web without a sidebar previews PDFs in the built-in browser window', async ({ page }, info) => {
  await fixture(page, { mode: 'web', standalone: true, dark: true });
  await page.locator('main').getByRole('button').filter({ hasText: 'report.PDF' }).click();
  const { browser } = await expectPdfBrowser(page);
  await page.screenshot({ path: info.outputPath('web-standalone-pdf.png') });
  await browser.getByRole('button', { name: '关闭 report.PDF', exact: true }).click();
  await expect(browser).toHaveCount(0);
});
