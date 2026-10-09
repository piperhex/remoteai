import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type {} from './download-manager-harness';

test.setTimeout(60_000);

async function enqueue(page: Page) {
  await page.getByRole('button', { name: '打开安装包' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '下载', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '暂停下载', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
}

test('desktop navigation exposes background downloads above diagnostics and saves complete files', async ({ page }) => {
  await page.goto('/e2e/download-manager-harness.html');
  const navigation = page.getByRole('navigation');
  const labels = await navigation.getByRole('button').allTextContents();
  expect(labels.indexOf('下载管理') + 1).toBe(labels.indexOf('日志诊断'));
  await enqueue(page);
  await page.getByRole('button', { name: '切换电脑', exact: true }).click();
  await enqueue(page);
  await navigation.getByRole('button', { name: '下载管理', exact: true }).click();
  const office = page.getByRole('article', { name: 'office.msi' });
  const home = page.getByRole('article', { name: 'home.msi' });
  await expect(office).toContainText('办公电脑');
  await expect(home).toContainText('家里电脑');
  await expect.poll(() => office.getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await office.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(office).toContainText('已暂停');
  await page.screenshot({ path: '../../.codex-tmp/desktop-download-manager.png' });
  await navigation.getByRole('button', { name: '日志诊断', exact: true }).click();
  await navigation.getByRole('button', { name: '下载管理', exact: true }).click();
  await expect(home).toContainText('文件已就绪');
  await office.getByRole('button', { name: '继续下载', exact: true }).click();
  await expect(office).toContainText('文件已就绪');
  const saved = page.waitForEvent('download');
  await office.getByRole('button', { name: '保存到设备' }).click();
  expect(await readFile((await (await saved).path())!)).toEqual(Buffer.alloc(8 * 1024 * 1024, 'A'));
  await page.getByRole('button', { name: '切换账号' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: '切换账号' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('disconnecting one computer pauses only its download and allows removing the task', async ({ page }) => {
  await page.goto('/e2e/download-manager-harness.html');
  await page.evaluate(() => { window.desktopDownloads.delay = 1200; });
  await enqueue(page);
  await page.getByRole('button', { name: '切换电脑', exact: true }).click();
  await enqueue(page);
  await page.getByRole('navigation').getByRole('button', { name: '下载管理', exact: true }).click();
  await page.getByRole('button', { name: '断开办公电脑' }).click();
  const office = page.getByRole('article', { name: 'office.msi' });
  await expect(office).toContainText('已暂停');
  await expect(office.getByRole('button', { name: '继续下载' })).toBeDisabled();
  await expect(page.getByRole('article', { name: 'home.msi' })).toContainText('文件已就绪', { timeout: 20_000 });
  await office.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^删\s*除$/ }).click();
  await expect(office).toHaveCount(0);
});

test('PC relay downloads use raw binary IPC and stay responsive through pause, resume and navigation',
  async ({ page }) => {
    await page.goto('/e2e/download-manager-harness.html?nativeBulk');
    await enqueue(page);
    const navigation = page.getByRole('navigation');
    await navigation.getByRole('button', { name: '下载管理', exact: true }).click();
    const office = page.getByRole('article', { name: 'office.msi' });
    await expect.poll(() => page.evaluate(() => window.desktopDownloads.nativeBulkStats.batches)).toBeGreaterThan(4);
    await office.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(office).toContainText('已暂停');
    const before = await page.evaluate(() => window.desktopDownloads.nativeBulkStats.polls);
    await office.getByRole('button', { name: '继续下载', exact: true }).click();
    await navigation.getByRole('button', { name: '日志诊断', exact: true }).click();
    await expect(page.locator('main')).toContainText('日志诊断');
    await navigation.getByRole('button', { name: '下载管理', exact: true }).click();
    await expect(office).toContainText('文件已就绪');
    const stats = await page.evaluate(() => window.desktopDownloads.nativeBulkStats);
    expect(stats.polls).toBeGreaterThan(before);
    expect(stats.batches).toBe(stats.acknowledged);
    expect(await page.evaluate(() => window.desktopDownloads.offsets)).toEqual([]);
    const saved = page.waitForEvent('download');
    await office.getByRole('button', { name: '保存到设备' }).click();
    expect(await readFile((await (await saved).path())!)).toEqual(Buffer.alloc(8 * 1024 * 1024, 'A'));
  });
