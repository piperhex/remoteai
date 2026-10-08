import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'The display bar is for viewers with a physical mouse.');
});

async function openDesktop(page: Page, native = false) {
  if (!native) await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: native ? '打开远程桌面' : '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…', { exact: true })).not.toBeVisible();
}

for (const native of [false, true]) {
  test(`switches displays in the ${native ? 'desktop client' : 'PC browser'}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`e2e/remote-desktop-harness.html?displays${native ? '&native-clipboard' : ''}`);
    await openDesktop(page, native);
    const bar = page.getByRole('navigation', { name: '显示器', exact: true });
    const primary = bar.getByRole('button', { name: '显示器 1 · 主屏 · 1600 × 900', exact: true });
    const secondary = bar.getByRole('button', { name: '显示器 2 · 900 × 1600', exact: true });
    await expect(primary).toHaveAttribute('aria-pressed', 'true');
    const bounds = (await bar.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual((await page.locator('.rd-stage').boundingBox())!.y);
    await primary.click();
    expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
    await page.getByRole('button', { name: '显示', exact: true }).click();
    await page.getByRole('button', { name: '高清', exact: true }).click();
    await page.getByRole('button', { name: '60 帧', exact: true }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await secondary.focus();
    await page.keyboard.press('Enter');
    await expect(secondary).toHaveAttribute('aria-pressed', 'true');
    await expect(secondary).toBeEnabled();
    await expect.poll(() => page.locator('video').evaluate(video => video.videoHeight > video.videoWidth)).toBe(true);
    expect(await page.evaluate(() => window.desktopTest.selectedDisplays)).toEqual(['display-1', 'display-2']);
    expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'keyboard'))).toEqual([]);
    expect(await page.evaluate(() => window.desktopTest.settings.at(-1)))
      .toMatchObject({ displayId: 'display-2', quality: 'clear', fps: 60 });
    await page.screenshot({ path: info.outputPath('display-bar-portrait.png') });
    const video = (await page.locator('video').boundingBox())!;
    await page.mouse.click(video.x + (video.width - 1) * 0.7, video.y + (video.height - 1) * 0.6);
    await page.keyboard.press('a');
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toMatchObject({ kind: 'keyboard', code: 'KeyA', down: false });
    expect(await page.evaluate(() => window.desktopTest.inputDisplays.at(-1))).toBe('display-2');
    expect(await page.evaluate(() => [...window.desktopTest.inputs].reverse().find(input => input.kind === 'move')))
      .toMatchObject({ x: expect.closeTo(0.7, 2), y: expect.closeTo(0.6, 2) });
    await primary.click();
    await expect(primary).toHaveAttribute('aria-pressed', 'true');
    await expect(primary).toBeEnabled();
    await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth > video.videoHeight)).toBe(true);
    await page.screenshot({ path: info.outputPath('display-bar-landscape.png') });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(3);
    expect(errors).toEqual([]);
  });
}

test('scrolls to the display selected in settings in a narrow PC window', async ({ page }, info) => {
  await page.setViewportSize({ width: 560, height: 700 });
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.evaluate(() => {
    for (let number = 3; number <= 8; number++) {
      window.desktopTest.displays.push({ id: `display-${number}`, name: `DISPLAY${number}`,
        primary: false, width: 1600, height: 900 });
    }
  });
  await openDesktop(page);
  const bar = page.getByRole('navigation', { name: '显示器', exact: true });
  expect(await bar.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '显示', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '显示设置' });
  await panel.getByRole('button', { name: '显示器 8 · 1600 × 900', exact: true }).click();
  const selected = bar.getByRole('button', { name: '显示器 8 · 1600 × 900', exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(selected).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  const bounds = (await selected.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(560);
  expect(await page.locator('.rd-root').evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.screenshot({ path: info.outputPath('display-bar-narrow.png') });
});

test('shows a single monitor and keeps older hosts without display metadata usable', async ({ page }) => {
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.evaluate(() => { window.desktopTest.displays.splice(1); });
  await openDesktop(page);
  const bar = page.getByRole('navigation', { name: '显示器', exact: true });
  await expect(bar.getByRole('button')).toHaveCount(1);
  await expect(bar.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto('e2e/remote-desktop-harness.html');
  await openDesktop(page);
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '远程桌面操作' })).toBeVisible();
});
