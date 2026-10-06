import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const originalRequests = (page: Page) => page.evaluate(() => window.previewFixture.requests
  .filter(request => request.operation === 'previewOpen' && request.preview === 'image').length);
async function open(page: Page) {
  await page.goto('e2e/preview-downloads-harness.html');
  await expect(page.locator('.chat-image img')).toBeVisible();
  await expect.poll(() => page.locator('.chat-image img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
  await page.getByRole('button', { name: '放大查看：透明图片' }).click();
}

test('previews use binary downloads, opening only shows the thumbnail, and explicit save reuses original bytes', async ({ page }, info) => {
  await open(page);
  expect(await originalRequests(page)).toBe(0);
  await expect(page.getByRole('button', { name: '查看原图', exact: true })).toBeVisible();
  await expect(page.getByText('正在加载原图…')).toHaveCount(0);
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect(page.getByText('正在加载原图…')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.previewFixture.tasks().filter(task => task.source.preview === 'image')
    .every(task => task.status === 'ready'))).toBe(true);
  await page.screenshot({ path: `../../.codex-tmp/preview-downloads-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载图片', exact: true }).click();
  const download = await event;
  expect(createHash('sha256').update(await readFile((await download.path())!)).digest('hex'))
    .toBe(await page.evaluate(() => window.previewFixture.hash));
  expect(await originalRequests(page)).toBe(1);
  expect(await page.evaluate(() => window.previewFixture.tasks().every(task => task.protocol === 'bulk'))).toBe(true);
  await page.getByRole('button', { name: '关闭图片' }).click();
  await page.getByRole('button', { name: '查看文本', exact: true }).click();
  await expect(page.getByText('这是统一下载的文本预览。')).toBeVisible();
  expect(await page.evaluate(() => window.previewFixture.requests.some(request =>
    ['imageChunk', 'imagePreview', 'textPreview', 'fileRead'].includes(String(request.operation))))).toBe(false);
});

test('save before viewing explicitly fetches original and reload reuses the persisted cache', async ({ page }) => {
  await open(page);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载图片', exact: true }).click();
  await event;
  expect(await originalRequests(page)).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: '放大查看：透明图片' }).click();
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect(page.getByText('正在加载原图…')).toHaveCount(0);
  expect(await originalRequests(page)).toBe(0);
});

test('retry continues a paused preview from verified blocks instead of starting again', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.previewFixture.delay = 500; });
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.previewFixture.tasks()
    .find(task => task.source.preview === 'image')?.received ?? 0)).toBeGreaterThanOrEqual(1024 * 1024);
  await page.evaluate(async () => {
    const task = window.previewFixture.tasks().find(task => task.source.preview === 'image')!;
    await window.previewFixture.pause(task.id); window.previewFixture.offsets = [];
  });
  await page.getByRole('button', { name: '重新加载原图', exact: true }).click();
  await expect(page.getByText('正在加载原图…')).toHaveCount(0);
  expect(await page.evaluate(() => window.previewFixture.offsets[0])).toBeGreaterThanOrEqual(1024 * 1024);
});

test('the image file header exports the same cached original as the full-screen viewer', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect(page.getByText('正在加载原图…')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭图片' }).click();
  await page.getByRole('button', { name: '打开图片文件' }).click();
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  const download = await saving;
  expect(createHash('sha256').update(await readFile((await download.path())!)).digest('hex'))
    .toBe(await page.evaluate(() => window.previewFixture.hash));
  expect(await originalRequests(page)).toBe(1);
});
