import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test('switches landscape and portrait displays, preserves settings, and recovers a removed display', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  if (info.project.name !== 'desktop') {
    await expect(page.getByRole('navigation', { name: '显示器', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: '显示', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '显示设置' });
  const primary = panel.getByRole('button', { name: '显示器 1 · 主屏 · 1600 × 900', exact: true });
  const secondary = panel.getByRole('button', { name: '显示器 2 · 900 × 1600', exact: true });
  await expect(primary).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '高清', exact: true }).click();
  await secondary.click();
  await expect(secondary).toHaveAttribute('aria-pressed', 'true');
  await expect(secondary).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoHeight > video.videoWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '高清', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.desktopTest.selectedDisplays)).toEqual(['display-1', 'display-2']);
  expect(await page.evaluate(() => window.desktopTest.closed)).toBe(1);
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth && node.clientWidth <= 400)).toBe(true);
  await page.screenshot({ path: info.outputPath('multi-display-settings.png') });
  await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
  await page.locator('.rd-touch').click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputDisplays.at(-1))).toBe('display-2');
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await primary.click();
  await expect(primary).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth > video.videoHeight)).toBe(true);
  await secondary.click(); await expect(secondary).toBeEnabled();
  // The next open re-enumerates screens, as happens after unplugging the chosen display.
  await page.evaluate(() => { window.desktopTest.displays.splice(1); });
  await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await expect(primary).toHaveAttribute('aria-pressed', 'true');
  await expect(secondary).toHaveCount(0);
  expect(errors).toEqual([]);
});
