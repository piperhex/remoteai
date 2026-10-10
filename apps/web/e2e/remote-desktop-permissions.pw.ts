import { expect, test } from '@playwright/test';

test('waits for Mac grants without repeated capture and connects after consent', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?macos&permissions');
  await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('请在 Mac 上允许屏幕录制');
  await expect(page.getByRole('status')).toContainText('请在 Mac 的远程设置中修复权限');
  await expect(page.getByRole('button', { name: '检查授权', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.desktopTest.permissionChecks), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.desktopTest.captureAttempts)).toBe(1);
  expect(await page.locator('.rd-status > span').evaluate(element => element.clientWidth)).toBeLessThanOrEqual(400);
  const message = await page.locator('.rd-status').boundingBox();
  expect(message!.x).toBeGreaterThanOrEqual(0);
  expect(message!.x + message!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('waiting-for-mac-permission.png') });
  await page.evaluate(() => { window.desktopTest.permissionRequired = 'accessibility'; });
  await expect(page.getByRole('status')).toContainText('请在 Mac 上允许辅助功能');
  expect(await page.evaluate(() => window.desktopTest.captureAttempts)).toBe(2);
  await page.evaluate(() => { window.desktopTest.permissionRequired = null; });
  await expect(page.locator('.rd-status')).not.toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.desktopTest.captureAttempts)).toBe(3);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});

test('closing while waiting cancels checks and never starts capture after a late grant', async ({ page }) => {
  await page.clock.install();
  await page.goto('e2e/remote-desktop-harness.html?macos&permissions');
  await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('请在 Mac 上允许屏幕录制');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const checks = await page.evaluate(() => {
    window.desktopTest.permissionRequired = null; return window.desktopTest.permissionChecks;
  });
  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.desktopTest.permissionChecks)).toBe(checks);
  expect(await page.evaluate(() => window.desktopTest.captureAttempts)).toBe(1);
  await expect(page.locator('.rd-root')).toHaveCount(0);
});
