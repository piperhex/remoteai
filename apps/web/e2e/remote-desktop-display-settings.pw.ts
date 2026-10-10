import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

async function openSettings(page: Page) {
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '显示', exact: true }).click();
  return page.getByRole('complementary', { name: '显示设置' });
}

test('scrolls all settings in a short window while keeping the header and close button visible', async ({ page }, info) => {
  const panel = await openSettings(page);
  await page.screenshot({ path: info.outputPath('display-settings.png') });
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 320 });
  const scroller = panel.getByRole('region', { name: '显示设置选项' });
  const close = panel.getByRole('button', { name: '关闭显示设置' });
  const headerBounds = (await close.boundingBox())!;
  expect(await scroller.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth && node.clientWidth <= 400)).toBe(true);
  await panel.getByText('拖动横线把手可移动鼠标面板。').scrollIntoViewIfNeeded();
  expect(await scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const instruction = (await panel.getByText('拖动横线把手可移动鼠标面板。').boundingBox())!;
  const panelBounds = (await panel.boundingBox())!;
  expect(instruction.y + instruction.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height);
  expect((await close.boundingBox())!.y).toBe(headerBounds.y);
  await page.screenshot({ path: info.outputPath('display-settings-scrolled.png') });
  await close.click();
  await expect(panel).toHaveCount(0);
});

test('hides stats, validates custom frame rates and keeps presets in sync', async ({ page }) => {
  const panel = await openSettings(page);
  const toggle = panel.getByRole('switch', { name: '隐藏连接状态' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.rd-stats')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.rd-stats')).toHaveCount(1);
  const input = panel.getByRole('spinbutton', { name: '自定义帧率' });
  const apply = panel.getByRole('button', { name: '应用帧率' });
  const before = await page.evaluate(() => window.desktopTest.settings.length);
  for (const invalid of ['', '0', '145', '30.5']) {
    await input.fill(invalid);
    await apply.click();
    await expect(panel.getByRole('alert')).toHaveText('请输入 1–144 的整数。');
  }
  expect(await page.evaluate(() => window.desktopTest.settings.length)).toBe(before);
  await input.fill('45');
  await apply.click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)?.fps)).toBe(45);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: '90 帧', exact: true }).click();
  await expect(input).toHaveValue('90');
  await expect(panel.getByRole('button', { name: '90 帧', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
