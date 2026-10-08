import { expect, test, type Page } from '@playwright/test';
import { externalCodePath, longMarkdown, markdown, sourceCode } from './file-preview-fixture';
import { screenshot } from './chat-helpers';
import { readFile } from 'node:fs/promises';

async function open(page: Page, path = 'verification.md') {
  await page.goto(`e2e/file-preview-harness.html?path=${encodeURIComponent(path)}`);
}
async function clipboard(page: Page) {
  return page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
}

test('previews HTML scripts in an isolated frame and retains source and download actions', async ({ page }) => {
  await open(page, 'page.HTML');
  const frame = page.frameLocator('iframe[title="HTML 预览"]');
  await expect(frame.getByRole('heading', { name: '页面预览' })).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-ready', 'yes');
  expect(await page.evaluate(() => Reflect.get(window, 'previewScriptRan'))).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('unsafe'))).toBeNull();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.chat-html-preview pre')).toContainText('<h1>页面预览</h1>');
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '页面预览' })).toBeVisible();
});

test('renders Markdown, preserves source copying and contains tables on narrow screens', async ({ page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const rendered = page.locator('.chat-markdown-preview .chat-markdown');
  await expect(rendered.getByRole('heading', { name: '文件预览', exact: true })).toBeVisible();
  await expect(rendered.locator('strong')).toHaveText('Markdown 渲染');
  await expect(rendered.locator('li')).toHaveCount(2);
  await expect(rendered.getByRole('cell', { name: '通过', exact: true })).toBeVisible();
  await expect(rendered.locator('pre')).toHaveText('const ready = true;');
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  await expect(page.getByText('引用位置：第 3 行')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'previewScriptRan'))).toBeUndefined();
  await page.getByRole('button', { name: '复制原文', exact: true }).click();
  expect(await clipboard(page)).toBe(markdown);
  const table = await rendered.locator('table').boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await screenshot(page, info, 'markdown-file-preview');
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await expect(rendered).toHaveCount(0);
  await expect(page.locator('.chat-markdown-preview pre')).toHaveText(markdown);
  await page.getByRole('button', { name: '复制原文', exact: true }).first().click();
  expect(await clipboard(page)).toBe(markdown);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(rendered.locator('table')).toBeVisible();
});

test('copies the complete source even when the long source view is paginated', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 'long.md');
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await expect(page.locator('pre')).not.toContainText('最后一行');
  await page.getByRole('button', { name: '复制原文', exact: true }).first().click();
  expect(await clipboard(page)).toBe(longMarkdown);
});

test('previews and copies code from an external deployment path', async ({ page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, externalCodePath);
  await expect(page.locator('pre')).toHaveText(sourceCode);
  await page.getByRole('button', { name: '复制文件内容', exact: true }).click();
  expect(await clipboard(page)).toBe(sourceCode);
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeEnabled();
  const code = await page.locator('pre').boundingBox();
  expect(code!.x + code!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await screenshot(page, info, 'external-code-file-preview');
});

test('handles uppercase extensions, empty files, ordinary source and load failures', async ({ page }) => {
  await open(page, 'README.MARKDOWN');
  await expect(page.locator('.chat-markdown-preview table')).toBeVisible();
  await open(page, 'empty.md');
  await expect(page.getByText('（空文件）')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制原文' })).toBeEnabled();
  await open(page, 'source.ts');
  await expect(page.locator('.chat-markdown-preview')).toHaveCount(0);
  await expect(page.locator('pre')).toHaveText('const ready = true;\n');
  await expect(page.getByRole('button', { name: '复制文件内容' })).toBeVisible();
  await open(page, 'missing.md');
  await expect(page.getByRole('status')).toContainText('暂时无法预览此文件');
  await expect(page.getByRole('button', { name: '复制原文' })).toHaveCount(0);
});

test('installer downloads use a compact card and can cancel, restart and save exact bytes', async ({ page }, info) => {
  const name = 'Remote AI_1.7.9_x64_en-US.msi';
  await open(page, name);
  const sheet = page.locator('.chat-download-sheet');
  await expect(sheet.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(sheet).not.toContainText('暂时无法预览');
  await sheet.getByRole('button', { name: '下载', exact: true }).click();
  const progress = sheet.getByRole('progressbar', { name: '下载进度', exact: true });
  await expect.poll(() => progress.getAttribute('value')).toMatch(/^[1-9]/);
  await expect(sheet.locator('.file-download-detail')).toContainText(/MB.*[KM]B\/s/);
  const bounds = await sheet.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(448);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await screenshot(page, info, 'installer-download-progress');
  await sheet.getByRole('button', { name: '取消下载', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('下载已取消');
  const saving = page.waitForEvent('download');
  await sheet.getByRole('button', { name: '下载', exact: true }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe(name);
  expect(await readFile((await download.path())!)).toEqual(Buffer.alloc(8 * 1024 * 1024, 'A'));
  await expect(sheet.getByRole('status')).toHaveText('文件已交给浏览器保存');
});

test('download cards contain long filenames and retain readable failure and offline states', async ({ page }, info) => {
  const name = `${'安装程序_very-long-name_'.repeat(8)}.MSI`;
  await page.goto(`e2e/file-preview-harness.html?path=${encodeURIComponent(name)}&download=offline`);
  const sheet = page.locator('.chat-download-sheet');
  await expect(sheet.getByRole('button', { name: '下载', exact: true })).toBeDisabled();
  const heading = sheet.getByRole('heading', { name, exact: true });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await screenshot(page, info, 'installer-download-long-name');
  await page.goto('e2e/file-preview-harness.html?path=installer.msi&download=error');
  await sheet.getByRole('button', { name: '下载', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('下载失败，请检查连接和存储空间后重试。');
  await expect(sheet.getByRole('button', { name: '下载', exact: true })).toBeEnabled();
});
