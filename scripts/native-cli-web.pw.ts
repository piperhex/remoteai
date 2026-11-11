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
      const headerConnection = page.locator('.chat-header .chat-connection-info');
      await expect(headerConnection).toContainText('Office PC');
      await expect(headerConnection).toContainText('P2P');
      await expect(page.locator('.chat-composer-hint .chat-connection-info')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '打开工具', exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-header.png`), animations: 'disabled' });
      await headerConnection.getByRole('button', { name: 'P2P · 连接体检', exact: true }).click();
      await expect(page.getByRole('heading', { name: '连接体检', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      const selector = page.locator('.chat-settings-connection .chat-settings-cli:visible');
      const openSettings = async () => {
        await expect(page.locator('.cli-gui-engine:visible')).toHaveCount(0);
        await page.getByRole('button', { name: /聊天设置/ }).click();
        await expect(selector).toBeVisible();
        const rows = page.locator('.chat-settings-connection > button');
        await expect(rows.nth(1)).toHaveAttribute('aria-label', '切换账户');
        await expect(rows.nth(2)).toHaveAttribute('aria-label', '选择 CLI');
        const maxHeight = await page.locator('.chat-settings-sheet:visible').evaluate(element =>
          parseFloat(getComputedStyle(element).maxHeight) / innerHeight);
        expect(maxHeight).toBeCloseTo(0.88, 2);
      };
      await openSettings();
      await expect(selector).toContainText('Codex GUI');
      await page.screenshot({ path: resolve(evidence, `${label}-codex-settings.png`), animations: 'disabled' });
      await selector.click();
      await expect(page.getByRole('radio', { name: 'Claude GUI', exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-selector.png`), animations: 'disabled' });
      await page.getByRole('radio', { name: 'Claude GUI', exact: true }).click();
      await openSettings();
      await expect(selector).toContainText('Claude GUI');
      await page.screenshot({ path: resolve(evidence, `${label}-claude-settings.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '下拉关闭', exact: true }).press('Enter');
      await page.getByRole('textbox', { name: '消息', exact: true }).fill('请检查共享组件。');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      const approve = page.getByRole('button', { name: '允许这一次', exact: true });
      await expect(approve).toBeEnabled();
      await approve.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, `${label}-claude-approval.png`), animations: 'disabled' });
      await approve.click();
      await expect(approve).not.toBeVisible();
      await openSettings();
      await selector.click();
      await expect(page.getByRole('radio', { name: 'Gemini GUI', exact: true })).toBeDisabled();
      await page.screenshot({ path: resolve(evidence, `${label}-locked.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '关闭', exact: true }).last().click();
      await page.getByRole('button', { name: '下拉关闭', exact: true }).press('Enter');
      await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
      await page.locator('[data-cli-thread="gemini-history"] button').click();
      await expect(page.locator('.chat-drawer')).not.toBeVisible();
      await expect(page.getByText('已读取项目说明。接下来会检查共享组件和现有测试。')).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-gemini-history.png`), animations: 'disabled' });
      await openSettings();
      await expect(selector).toContainText('Gemini GUI');
      await expect(page.locator('.chat-settings-mobile .chat-usage-card')).toBeVisible();
      const modes = page.getByRole('radiogroup', { name: '权限模式', exact: true });
      await expect(modes.getByRole('radio').first()).toBeDisabled();
      await page.screenshot({ path: resolve(evidence, `${label}-gemini-settings.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '下拉关闭', exact: true }).press('Enter');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      const calls = await page.evaluate(() =>
        (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture.calls);
      expect(calls).toContainEqual(expect.objectContaining({ engine: 'claude', action: 'approve', actionId: 'once:exact' }));
    });
}

test('mobile web: settings can switch away from a missing CLI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await localBackend(page, false);
  await page.goto('/e2e/cli-gui-harness.html?mode=web&missing');
  const openSelector = async () => {
    await expect(page.locator('.cli-gui-engine:visible')).toHaveCount(0);
    await page.getByRole('button', { name: /聊天设置/ }).click();
    await page.locator('.chat-settings-cli:visible').click();
  };
  await openSelector();
  await page.getByRole('radio', { name: 'Claude GUI', exact: true }).click();
  await expect(page.locator('.cli-gui-install-region')).toBeVisible();
  await openSelector();
  await page.getByRole('radio', { name: 'Codex GUI', exact: true }).click();
  await expect(page.locator('.cli-gui-pane')).toHaveCount(0);
  await expect(page.locator('.adm-popup')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toBeVisible();
});

for (const engine of ['claude', 'gemini'] as const) for (const enlarged of [false, true]) {
  test(`mobile web: ${engine} reuses compact settings and nested model picker ${enlarged ? 'large dark' : 'light'}`,
    async ({ page }) => {
      await page.setViewportSize({ width: enlarged ? 360 : 390, height: 844 });
      await localBackend(page);
      await page.goto(`/e2e/cli-gui-harness.html?mode=web${enlarged ? '&large&dark' : ''}`);
      await expect(page.getByRole('button', { name: /聊天设置/ })).toBeVisible();
      await page.evaluate(engine => {
        const fixture = (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture;
        fixture.setCatalog(async () => ({ status: 'ready', models: [
          { id: 'model-a', label: 'Model A', isDefault: true, defaultEffort: 'high',
            efforts: [{ id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }] },
          ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map(name => ({ id: `model-${name.toLowerCase()}`,
            label: `Model ${name}`, efforts: [] })),
        ], modes: (engine === 'claude' ? ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan']
          : ['default', 'autoEdit', 'yolo', 'plan']).map(id => ({ id, label: id })), defaultMode: 'default' }),
        () => 'model-a');
      }, engine);
      await page.getByRole('button', { name: /聊天设置/ }).click();
      await page.locator('.chat-settings-cli:visible').click();
      await page.getByRole('radio', { name: engine === 'claude' ? 'Claude GUI' : 'Gemini GUI', exact: true }).click();
      const label = `mobile-web-${enlarged ? 'dark-20px-360' : 'light-14px-390'}-${engine}`;
      const project = page.getByRole('button', { name: '选择项目', exact: true });
      await project.click();
      await page.locator('.chat-project-option').filter({ hasText: 'Remote AI' }).click();
      await expect(project).toContainText('Remote AI');
      await project.click();
      await expect(page.locator('.chat-project-option[aria-pressed="true"]')).toContainText('Remote AI');
      await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-projects.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '未归属项目', exact: true }).click();
      await expect(project).toContainText('未选择项目');
      await page.getByRole('button', { name: /聊天设置/ }).click();
      await expect(page.locator('.chat-settings-mobile .chat-usage-card')).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Model B', exact: true })).toHaveCount(0);
      const model = page.getByRole('button', { name: '设置模型', exact: true });
      await expect(model).toContainText('Model A');
      await page.screenshot({ path: resolve(evidence, `${label}-unified-settings.png`), animations: 'disabled' });
      await model.click();
      await expect(page.locator('.chat-setting-options').getByRole('radio')).toHaveCount(8);
      await page.screenshot({ path: resolve(evidence, `${label}-models.png`), animations: 'disabled' });
      await page.getByRole('radio', { name: 'Model B', exact: true }).click();
      await expect(model).toContainText('Model B');
      await expect(page.getByRole('radiogroup', { name: '推理强度', exact: true })).toHaveCount(0);
      await model.click(); await page.getByRole('radio', { name: 'Model A', exact: true }).click();
      const effort = page.getByRole('radiogroup', { name: '推理强度', exact: true });
      await effort.getByRole('radio', { name: '中', exact: true }).click();
      await expect(effort.getByRole('radio', { name: '中', exact: true })).toHaveAttribute('aria-checked', 'true');
      const modes = page.getByRole('radiogroup', { name: '权限模式', exact: true });
      await modes.getByRole('radio', { name: '计划模式', exact: true }).click();
      await expect(modes.getByRole('radio', { name: '计划模式', exact: true })).toHaveAttribute('aria-checked', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}
