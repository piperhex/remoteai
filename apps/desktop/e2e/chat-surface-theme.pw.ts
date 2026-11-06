import { expect, test } from '@playwright/test';
import { assertSurfaceReadable, checkChatSurfaceTheme } from './chat-surface-theme-checks';

for (const mode of ['local', 'remote']) {
  for (const scenario of ['light', 'dark', 'dark-large']) {
    test(`${mode}: ${scenario} computer, connection and command surfaces stay readable`, async ({ page }, info) => {
      await page.setViewportSize({ width: scenario.endsWith('large') ? 900 : 1280, height: 1000 });
      await page.goto(`/e2e/chat-surface-theme-harness.html?mode=${mode}`
        + `${scenario.startsWith('dark') ? '&dark' : ''}${scenario.endsWith('large') ? '&large' : ''}`);
      await checkChatSurfaceTheme(page, info, mode);
    });
  }
}

test('updates open connection panels and status colors when switching theme', async ({ page }, info) => {
  await page.goto('/e2e/chat-surface-theme-harness.html?mode=remote');
  for (const state of ['P2P', '等待连接', '连接失败']) {
    if (state !== 'P2P') await page.getByRole('button', { name: state, exact: true }).click();
    await page.getByRole('button', { name: 'P2P · 连接体验' }).click();
    const panel = page.locator('.connection-health-sheet');
    const status = { P2P: 'ok', 等待连接: 'waiting', 连接失败: 'blocked' }[state];
    await expect(panel.locator('.connection-health-summary')).toHaveClass(new RegExp(`health-${status}`));
    await assertSurfaceReadable(panel.locator('strong, dt, p'));
    const background = await panel.locator('.connection-health-summary').evaluate(node => getComputedStyle(node).backgroundColor);
    await page.getByRole('button', { name: '切换主题' }).evaluate(button => (button as HTMLButtonElement).click());
    await expect.poll(() => panel.locator('.connection-health-summary')
      .evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background);
    await assertSurfaceReadable(panel.locator('strong, dt, p'));
    await page.screenshot({ path: info.outputPath(`${state}-theme-switch.png`) });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
});
