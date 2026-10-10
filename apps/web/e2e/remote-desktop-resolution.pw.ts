import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test('changes ordinary and private desktop resolution without reconnecting', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?privacy&displays&resolutions');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const before = await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures }));
  for (const privateScreen of [false, true]) {
    if (privateScreen) await page.getByRole('button', { name: '隐私屏', exact: true }).click();
    await page.getByRole('button', { name: '显示', exact: true }).click();
    const size = privateScreen ? '2560 × 1440' : '1920 × 1080';
    const choice = page.getByRole('group', { name: '分辨率', exact: true }).getByRole('button', { name: size });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(choice).toBeEnabled();
    expect(await page.locator('.rd-display-settings').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`resolution-${privateScreen ? 'private' : 'ordinary'}.png`) });
    await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
  }
  expect(await page.evaluate(() => window.desktopTest.resolutionChanges))
    .toEqual([{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]);
  expect(await page.evaluate(() => ({ closed: window.desktopTest.closed, captures: window.desktopTest.captures })))
    .toEqual(before);
});
