import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCliGuiFixture, sidebarCodexThread } from './cli-gui-fixture';

import { localBackend } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-install-composer-evidence');

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: per-conversation CLI, version, approval and history ${enlarged ? 'large dark narrow' : 'default'}`,
      async ({ page }) => {
        page.setDefaultTimeout(10_000);
        page.setDefaultNavigationTimeout(90_000);
        await mkdir(evidence, { recursive: true });
        await page.setViewportSize(enlarged ? { width: 960, height: 900 } : { width: 1440, height: 980 });
        const fixture = await localBackend(page);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}${enlarged ? '&large&dark' : ''}`);
        const label = `${mode}-${enlarged ? 'large-dark-narrow' : 'default-light'}`;
        const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
        if (await expand.isVisible()) await expand.click();
        const selector = page.locator('.cli-gui-engine:visible');
        await expect(selector).toContainText('Codex GUI');
        await expect(selector).toContainText('0.150.0');
        const nativeRow = page.getByRole('button', { name: sidebarCodexThread.name!, exact: true });
        const cliRow = page.locator('[data-cli-thread="claude-history"] button');
        await expect(cliRow).toBeVisible();
        await expect(nativeRow).toBeVisible();
        await expect(page.locator('[data-cli-thread]')).toHaveCount(2);
        await expect(cliRow).toHaveText('检查项目结构');
        await expect(page.locator('[data-cli-thread] small')).toHaveCount(0);
        const group = nativeRow.locator('xpath=ancestor::section[1]');
        await expect(group.locator('[data-cli-thread]')).toHaveCount(2);
        expect(await group.getByRole('button').filter({ hasText: /评审界面改动|检查项目结构|整理测试计划/ })
          .allTextContents()).toEqual(['评审界面改动', '检查项目结构', '整理测试计划']);
        const rowStyle = (node: HTMLElement) => ({ height: node.getBoundingClientRect().height,
          padding: getComputedStyle(node).padding,
          fontSize: getComputedStyle(node.firstElementChild!).fontSize });
        expect(await cliRow.evaluate(rowStyle)).toEqual(await nativeRow.evaluate(rowStyle));
        await selector.click();
        await expect(page.getByRole('menuitem', { name: 'Claude GUI' })).toBeVisible();
        await expect(page.locator('.ant-dropdown:visible')).toHaveCSS('opacity', '1');
        await page.screenshot({ path: resolve(evidence, `${label}-selector.png`), animations: 'disabled' });
        await page.getByRole('menuitem', { name: 'Claude GUI' }).click();
        await expect(selector).toContainText('Claude GUI · 2.1.42');
        await page.locator('header.workspace-toolbar').getByRole('button', { name: '更新 CLI', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Claude Code 官方安装说明' }))
          .toHaveAttribute('href', 'https://code.claude.com/docs/en/setup#install-claude-code');
        await page.locator('header.workspace-toolbar').getByRole('button', { name: '更新 CLI', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Claude Code 官方安装说明' })).not.toBeVisible();
        await page.locator('.cli-gui-pane [data-project-bar] button[aria-haspopup="menu"]').first().click();
        await page.getByRole('menuitemradio', { name: 'Remote AI', exact: true }).click();
        await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'GPT-6' })).toBeVisible();
        await page.getByRole('textbox', { name: '消息', exact: true }).fill('请检查共享组件并补充项目说明。');
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        await expect(page.getByText('README.md · 补充本地开发步骤')).toBeVisible();
        await expect(page.getByRole('button', { name: '允许这一次', exact: true })).toBeEnabled();
        await page.screenshot({ path: resolve(evidence, `${label}-claude-approval.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '允许这一次', exact: true }).click();
        await expect(page.getByRole('region', { name: '需要审批', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '加载更早的消息', exact: true }).click();
        await expect(page.getByText('更早的项目讨论已恢复。')).toBeVisible();
        await selector.click();
        await expect(page.getByRole('menuitem', { name: 'Gemini GUI' })).toHaveAttribute('aria-disabled', 'true');
        await page.locator('.cli-gui-pane').click({ position: { x: 20, y: 20 } });
        await expect(page.getByRole('menu')).not.toBeVisible();
        await page.locator('[data-cli-thread] button').filter({ hasText: '整理测试计划' }).click();
        await expect(selector).toContainText('Gemini GUI · 0.32.1');
        await page.locator('header.workspace-toolbar').getByRole('button', { name: '更新 CLI', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Gemini CLI 官方安装说明' }))
          .toHaveAttribute('href', 'https://geminicli.com/docs/get-started/installation/');
        await page.locator('header.workspace-toolbar').getByRole('button', { name: '更新 CLI', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Gemini CLI 官方安装说明' })).not.toBeVisible();
        await expect(page.getByText('已读取项目说明。接下来会检查共享组件和现有测试。')).toBeVisible();
        await page.screenshot({ path: resolve(evidence, `${label}-gemini-history.png`), animations: 'disabled' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        const calls = mode === 'local' ? fixture.calls : await page.evaluate(() =>
          (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture.calls);
        expect(calls).toContainEqual(expect.objectContaining({ engine: 'claude', action: 'approve', actionId: 'once:exact' }));
        const typography = await page.locator('.cli-gui-pane').evaluate(node => ({
          size: getComputedStyle(node).fontSize, family: getComputedStyle(node).fontFamily,
        }));
        expect(typography.size).toBe(enlarged ? '20px' : '14px');
        expect(typography.family).toContain('sans-serif');
        await nativeRow.click();
        await expect(selector).toContainText('Codex GUI');
        const fixedHint = page.getByRole('tooltip').filter({ hasText: '当前对话使用的 CLI 已固定' });
        await selector.hover();
        await page.waitForTimeout(400);
        await expect(fixedHint).not.toBeVisible();
        await selector.click();
        const disabledEngine = page.getByRole('menuitem', { name: 'Claude GUI', exact: true });
        await expect(disabledEngine).toHaveAttribute('aria-disabled', 'true');
        await disabledEngine.hover({ position: { x: 2, y: 2 } });
        await expect(fixedHint).toBeVisible();
        await expect(page.locator('.ant-tooltip').filter({ has: fixedHint })).toHaveCSS('opacity', '1');
        await expect(fixedHint).toBeInViewport();
        expect((await fixedHint.boundingBox())!.width).toBeLessThanOrEqual(400);
        await page.screenshot({ path: resolve(evidence, `${label}-disabled-engine-hint.png`), animations: 'disabled' });
        await disabledEngine.click({ force: true });
        await expect(selector).toContainText('Codex GUI');
        await page.getByRole('menuitem', { name: 'Codex GUI', exact: true }).hover();
        await expect(fixedHint).not.toBeVisible();
        await page.screenshot({ path: resolve(evidence, `${label}-selected-engine-no-hint.png`), animations: 'disabled' });
      });
  }
  test(`${mode}: one-click installation, official sources and live language switching`, async ({ page }) => {
    await localBackend(page, false);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&missing`);
    for (const [name, url] of [['Claude GUI', 'https://code.claude.com/docs/en/setup#install-claude-code'],
      ['Gemini GUI', 'https://geminicli.com/docs/get-started/installation/']]) {
      await page.locator('.cli-gui-engine:visible').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await expect(page.locator('.cli-gui-setup').getByRole('button', { name: '一键安装', exact: true })).toBeVisible();
      const link = page.locator('.cli-gui-setup .cli-gui-install-link a');
      await expect(link).toHaveAttribute('href', url);
      await page.context().route(url.split('#')[0], route => route.fulfill({ body: 'Official installation fixture' }));
      const popup = page.waitForEvent('popup');
      await link.click();
      const official = await popup;
      await official.waitForLoadState(); expect(official.url()).toBe(url); await official.close();
      const engine = name.startsWith('Claude') ? 'claude' : 'gemini';
      await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-install.png`), animations: 'disabled' });
      await page.locator('.cli-gui-setup').getByRole('button', { name: '一键安装', exact: true }).click();
      await expect(page.locator('.cli-gui-setup').getByRole('status')).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-installing.png`), animations: 'disabled' });
      await expect(page.locator('.cli-gui-setup')).not.toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.cli-gui-engine:visible')).not.toContainText('版本未知');
    }
    await page.screenshot({ path: resolve(evidence, `${mode}-missing-official-install.png`), animations: 'disabled' });
    for (const language of ['en', 'ru', 'ja', 'zh']) {
      await page.evaluate(value => (window as unknown as { setCliLanguage: (language: string) => void })
        .setCliLanguage(value), language);
      await expect(page.locator('.cli-gui-engine:visible')).toContainText('Gemini GUI');
      await expect(page.locator('.cli-gui-engine:visible')).not.toContainText('client.cliGui.');
    }
  });
  test(`${mode}: existing account picker supplies third-party models to either CLI`, async ({ page }) => {
    const fixture = await localBackend(page);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}`);
    const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.locator('.cli-gui-engine:visible').click();
    await page.getByRole('menuitem', { name: 'Gemini GUI', exact: true }).click();
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'GPT-6' })).toBeVisible();
    await page.getByRole('button', { name: '切换 GUI 账户：Remote AI', exact: true }).click();
    await page.getByRole('button').filter({ hasText: 'Team API' }).click();
    if (mode === 'local') {
      await fixture.accounts.select({ kind: 'provider', id: 'provider' });
      await page.getByRole('button', { name: '刷新 CLI 和模型', exact: true }).click();
    }
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'Team Model' })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, `${mode}-third-party-model.png`), animations: 'disabled' });
    await page.locator('.cli-gui-engine:visible').click();
    await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'Team Model' })).toBeVisible();
  });
}
