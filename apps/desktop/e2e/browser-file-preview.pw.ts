import { expect, test, type Page } from '@playwright/test';
import { previewSamples, samplePdf } from './preview-samples';
import { sshEditorFixture } from './ssh-editor-fixture';
import tauriConfig from '../src-tauri/tauri.conf.json' with { type: 'json' };

const row = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const panel = (page: Page) => page.locator('.pf-file-panel:visible');

async function checkPreviews(page: Page) {
  await row(page, 'report.PDF').click();
  await expect(panel(page).locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
  await expect(panel(page).locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '1');
  await panel(page).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(panel(page).locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '2');
  await expect(panel(page).locator('.file-pdf-page[data-pdf-page="2"] canvas')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('pdf-preview.png') });
  await row(page, 'guide.md').click();
  await expect(panel(page).getByRole('heading', { name: 'Preview heading' })).toBeVisible();
  await expect.poll(() => panel(page).getByRole('img', { name: 'Document image' })
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
  await panel(page).getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(panel(page).locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
  await row(page, 'guide.md').click();
  await panel(page).getByRole('button', { name: '源码', exact: true }).click();
  const editor = panel(page).getByRole('textbox', { name: '文件内容', exact: true });
  await editor.fill('# Edited preview');
  await panel(page).getByRole('button', { name: '预览', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Edited preview' })).toBeVisible();
  await row(page, 'page.html').click();
  await expect(panel(page).frameLocator('iframe').getByRole('heading', { name: 'HTML preview' })).toBeVisible();
  await expect(panel(page).frameLocator('iframe').getByRole('heading')).toHaveCSS('color', 'rgb(17, 119, 85)');
  await expect.poll(() => panel(page).frameLocator('iframe').getByAltText('HTML asset')
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
  expect(await page.evaluate(() => document.body.dataset.escaped)).toBeUndefined();
  await page.screenshot({ path: test.info().outputPath('html-preview.png') });
  await panel(page).frameLocator('iframe').getByAltText('HTML asset').click();
  const imagePreview = page.getByRole('dialog', { name: 'HTML asset' });
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => imagePreview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
  await page.screenshot({ path: test.info().outputPath('html-linked-image.png') });
  await imagePreview.getByRole('button', { name: '关闭图片', exact: true }).click();
  await expect(panel(page).frameLocator('iframe').getByRole('heading', { name: 'HTML preview' })).toBeVisible();
  await row(page, 'image.svg').click();
  await expect.poll(() => panel(page).locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
  await row(page, 'sound.wav').click();
  await expect.poll(() => panel(page).locator('audio').evaluate((media: HTMLMediaElement) => media.duration)).toBe(1);
  await row(page, 'video.mp4').click();
  await expect.poll(() => panel(page).locator('video').evaluate((media: HTMLVideoElement) => media.videoWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('video-preview.png') });
  await row(page, 'broken.pdf').click();
  await expect(panel(page).getByText('无法打开此 PDF，请下载后用 PDF 阅读器查看。')).toBeVisible();
}

test('desktop content policy permits PDF fonts, workers, images and media previews', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/e2e/project-browser-harness.html?mode=local');
  const files = Object.fromEntries(Object.entries(previewSamples()).map(([name, bytes]) => [name, bytes.toString('base64')]));
  const policy = Object.entries(tauriConfig.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; ');
  await page.evaluate(({ files, policy }) => {
    (window as unknown as { setPreviewFiles: (files: Record<string, string>) => void }).setPreviewFiles(files);
    const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = policy;
    document.head.append(meta);
  }, { files, policy });
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await checkPreviews(page);
});

test('SSH previews a 12 MB PDF in bounded chunks', async ({ page }) => {
  const fixture = await sshEditorFixture(page);
  const pdf = samplePdf();
  // Comments before the final startxref keep the document valid while exceeding the old text/image limits.
  const largePdf = Buffer.concat([pdf, Buffer.from('%' + ' '.repeat(12 * 1024 * 1024) + '\n'),
    Buffer.from(pdf.subarray(pdf.lastIndexOf('startxref')))]);
  fixture.files.set('/large.pdf', largePdf);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/e2e/ssh-harness.html?mode=local&cloud=1');
  await page.getByRole('button', { name: '打开终端', exact: true }).click();
  await page.getByRole('button', { name: '终端连接选项' }).click();
  await page.getByRole('menuitem', { name: 'Editor server', exact: true }).click();
  await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
  await row(page, 'large.pdf').click();
  await expect(panel(page).locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '1');
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: project browser previews conversation document and media formats`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/e2e/project-browser-harness.html?mode=${mode}`);
    const files = Object.fromEntries(Object.entries(previewSamples()).map(([name, bytes]) => [name, bytes.toString('base64')]));
    await page.evaluate(files => (window as unknown as { setPreviewFiles: (files: Record<string, string>) => void })
      .setPreviewFiles(files), files);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await checkPreviews(page);
  });

  test(`${mode}: SSH browser previews conversation document and media formats`, async ({ page }) => {
    const fixture = await sshEditorFixture(page);
    for (const [name, bytes] of Object.entries(previewSamples())) fixture.files.set(`/${name}`, bytes);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/e2e/ssh-harness.html?mode=${mode}&cloud=1`);
    await page.getByRole('button', { name: mode === 'web' ? '打开远程终端' : '打开终端', exact: true }).click();
    await page.getByRole('button', { name: '终端连接选项' }).click();
    await page.getByRole('menuitem', { name: 'Editor server', exact: true }).click();
    await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
    const resize = page.getByRole('separator', { name: '调整详情抽屉宽度' });
    await resize.focus(); await page.keyboard.press('End');
    await expect(page.locator('.pf-browser')).toHaveAttribute('data-narrow', 'false');
    await checkPreviews(page);
  });
}
