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
