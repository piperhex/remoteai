import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test('privacy is off by default and toggles without reconnecting in narrow and desktop layouts', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?privacy&displays');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const button = page.getByRole('button', { name: '隐私屏', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const before = await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures }));
  expect(await page.evaluate(() => window.desktopTest.privacyChanges)).toEqual([]);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toBeEnabled();
  await page.screenshot({ path: info.outputPath('privacy-screen-enabled.png') });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.desktopTest.privacyChanges)).toEqual([true, false]);
  expect(await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures })))
    .toEqual(before);
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  expect(await page.locator('.rd-root').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('hosts without privacy support retain the ordinary desktop', async ({ page }) => {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '隐私屏', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.desktopTest.privacyChanges)).toEqual([]);
});

test('installation guidance keeps video running and privacy can be retried after local approval', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?privacy&privacy-install');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const button = page.getByRole('button', { name: '隐私屏', exact: true });
  const before = await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures }));
  await button.click();
  const guidance = page.getByText('请在电脑上确认安装，完成后再点一次隐私屏。', { exact: true });
  await expect(guidance).toBeVisible();
  expect((await guidance.boundingBox())!.width).toBeLessThanOrEqual(400);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toBeEnabled();
  const frames = await page.evaluate(() => window.desktopTest.frames);
  await expect.poll(() => page.evaluate(() => window.desktopTest.frames)).toBeGreaterThan(frames);
  await page.screenshot({ path: info.outputPath('privacy-install-confirmation.png') });
  await page.evaluate(() => { window.desktopTest.privacyInstallationRequired = false; });
  await page.getByRole('button', { name: '重试隐私屏', exact: true }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(guidance).not.toBeVisible();
  expect(await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures })))
    .toEqual(before);
});
