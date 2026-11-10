import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCliGuiFixture } from './cli-gui-fixture';

const evidence = resolve('../../.codex-tmp/cli-gui-evidence');
async function localBackend(page: Page, ready = true) {
  const fixture = createCliGuiFixture(ready);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'cli_gui_request') result = await fixture.transport.request(args.request);
    if (command === 'codex_gui_cli_status') result = { version: ready ? '0.150.0' : null };
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: 1 }, reset: false, events: [] };
    if (command === 'codex_gui_model_settings') result = { threadId: null, selection: null, revision: 0 };
    if (command === 'codex_gui_request') {
      let data: unknown = { data: [], nextCursor: null };
      if (args.request.operation === 'models') data = { data: [{ id: 'test-model', model: 'test-model',
        displayName: 'GPT-6', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }] };
      if (args.request.operation === 'plugins') data = { marketplaces: [], marketplaceLoadErrors: [] };
      result = { data };
    }
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    await route.fulfill({ json: { ok: true, result } });
  });
  return fixture;
}

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: per-conversation CLI, version, approval and history ${enlarged ? 'large dark narrow' : 'default'}`,
      async ({ page }) => {
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
        await selector.click();
        await expect(page.getByRole('menuitem', { name: 'Claude GUI' })).toBeVisible();
        await expect(page.locator('.ant-dropdown:visible')).toHaveCSS('opacity', '1');
        await page.screenshot({ path: resolve(evidence, `${label}-selector.png`), animations: 'disabled' });
        await page.getByRole('menuitem', { name: 'Claude GUI' }).click();
        await expect(selector).toContainText('Claude GUI · 2.1.42');
        await expect(page.getByRole('link', { name: '安装 Claude Code（官方）' }))
          .toHaveAttribute('href', 'https://code.claude.com/docs/en/setup#install-claude-code');
        const path = page.getByRole('textbox', { name: '项目目录', exact: true });
        await path.fill('F:/projects/remoteai'); await path.blur();
        await page.getByRole('textbox', { name: '消息', exact: true }).fill('请检查共享组件并补充项目说明。');
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        await expect(page.getByText('README.md · 补充本地开发步骤')).toBeVisible();
        await expect(page.getByRole('button', { name: '允许这一次', exact: true })).toBeEnabled();
        await page.screenshot({ path: resolve(evidence, `${label}-claude-approval.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '允许这一次', exact: true }).click();
        await expect(page.locator('.cli-gui-permission')).toHaveCount(0);
        await page.getByRole('button', { name: '加载更早的消息', exact: true }).click();
        await expect(page.getByText('更早的项目讨论已恢复。')).toBeVisible();
        await selector.click();
        await expect(page.getByRole('menuitem', { name: 'Gemini GUI' })).toHaveAttribute('aria-disabled', 'true');
        await page.locator('.cli-gui-messages').click({ position: { x: 20, y: 20 } });
        await expect(page.getByRole('menu')).not.toBeVisible();
        await page.locator('.cli-gui-thread-list button').filter({ hasText: '整理测试计划' }).click();
        await expect(selector).toContainText('Gemini GUI · 0.32.1');
        await expect(page.getByRole('link', { name: '安装 Gemini CLI（官方）' }))
          .toHaveAttribute('href', 'https://geminicli.com/docs/get-started/installation/');
        await expect(page.getByText('已读取项目说明。接下来会检查共享组件和现有测试。')).toBeVisible();
        await page.screenshot({ path: resolve(evidence, `${label}-gemini-history.png`), animations: 'disabled' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        const calls = mode === 'local' ? fixture.calls : await page.evaluate(() =>
          (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture.calls);
        expect(calls).toContainEqual(expect.objectContaining({ engine: 'claude', action: 'approve', actionId: 'once:exact' }));
        const typography = await page.locator('.cli-gui-messages').evaluate(node => ({
          size: getComputedStyle(node).fontSize, family: getComputedStyle(node).fontFamily,
        }));
        expect(typography.size).toBe(enlarged ? '20px' : '14px');
        expect(typography.family).toContain('sans-serif');
      });
  }
  test(`${mode}: official installation links and live language switching`, async ({ page }) => {
    await localBackend(page, false);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&missing`);
    for (const [name, url] of [['Claude GUI', 'https://code.claude.com/docs/en/setup#install-claude-code'],
      ['Gemini GUI', 'https://geminicli.com/docs/get-started/installation/']]) {
      await page.locator('.cli-gui-engine:visible').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await expect(page.getByRole('button', { name: '准备聊天组件', exact: true })).toBeVisible();
      const link = page.locator('.cli-gui-install-link');
      await expect(link).toHaveAttribute('href', url);
      await page.context().route(url.split('#')[0], route => route.fulfill({ body: 'Official installation fixture' }));
      const popup = page.waitForEvent('popup');
      await link.click();
      const official = await popup;
      await official.waitForLoadState(); expect(official.url()).toBe(url); await official.close();
    }
    await page.screenshot({ path: resolve(evidence, `${mode}-missing-official-install.png`), animations: 'disabled' });
    for (const language of ['en', 'ru', 'ja', 'zh']) {
      await page.evaluate(value => (window as unknown as { setCliLanguage: (language: string) => void })
        .setCliLanguage(value), language);
      await expect(page.locator('.cli-gui-engine:visible')).toContainText('Gemini GUI');
      await expect(page.locator('.cli-gui-install-link')).not.toContainText('client.cliGui.');
    }
  });
}
