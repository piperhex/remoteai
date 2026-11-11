import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend } from '../apps/desktop/e2e/cli-gui-support';
import type { createCliGuiFixture } from '../apps/desktop/e2e/cli-gui-fixture';

const evidence = resolve('.codex-tmp/native-cli-evidence');
for (const enlarged of [false, true]) {
  test(`mobile web: CLI selection, approval and locked history ${enlarged ? 'large dark' : 'default light'}`,
    async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: enlarged ? 360 : 390, height: 844 });
      await localBackend(page);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/e2e/cli-gui-harness.html?mode=web${enlarged ? '&large&dark' : ''}`);
      const label = `mobile-web-${enlarged ? 'dark-20px-360' : 'light-14px-390'}`;
      const selector = page.locator('.cli-gui-engine:visible');
      await expect(selector).toContainText('Codex GUI');
      await selector.click();
      await expect(page.getByRole('menuitem', { name: 'Claude GUI', exact: true })).toBeVisible();
      await expect(page.locator('.ant-dropdown:visible')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: resolve(evidence, `${label}-selector.png`), animations: 'disabled' });
      await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
      await expect(selector).toContainText('Claude GUI');
      await page.getByRole('textbox', { name: '消息', exact: true }).fill('请检查共享组件。');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      const approve = page.getByRole('button', { name: '允许这一次', exact: true });
      await expect(approve).toBeEnabled();
      await approve.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, `${label}-claude-approval.png`), animations: 'disabled' });
      await approve.click();
      await expect(approve).not.toBeVisible();
      await selector.click();
      await expect(page.getByRole('menuitem', { name: 'Gemini GUI', exact: true }))
        .toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
      await page.locator('[data-cli-thread="gemini-history"] button').click();
      await expect(page.locator('.chat-drawer')).not.toBeVisible();
      await expect(selector).toContainText('Gemini GUI');
      await expect(page.getByText('已读取项目说明。接下来会检查共享组件和现有测试。')).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-gemini-history.png`), animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      const calls = await page.evaluate(() =>
        (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture.calls);
      expect(calls).toContainEqual(expect.objectContaining({ engine: 'claude', action: 'approve', actionId: 'once:exact' }));
    });
}
