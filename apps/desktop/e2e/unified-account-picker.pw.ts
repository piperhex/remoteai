import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../src/demo';

const claudeId = `claude_${'a'.repeat(32)}`;
const secondId = `claude_${'b'.repeat(32)}`;
const accounts = [
  { ...DEMO_ACCOUNTS[0], id: 'codex', email: 'codex@example.test', active: true, localProxyCompatible: true },
  ...[claudeId, secondId].map((id, index) => ({ ...DEMO_ACCOUNTS[0], id, accountSource: 'claudeCode',
    email: `claude${index + 1}@example.test`, plan: 'Pro', active: index === 0, localProxyCompatible: false, usage: {} })),
];

async function fixture(page: Page) {
  let selected = { kind: 'account', id: 'codex' };
  let claude = claudeId;
  let fail = false;
  const calls: Array<{ command: string; args: { request?: { action: string; id?: string } } }> = [];
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args } = route.request().postDataJSON();
    calls.push({ command, args });
    let result: unknown = null;
    if (command === 'codex_gui_account_selection') result = selected;
    else if (command === 'list_accounts') result = accounts.map(account => ({ ...account,
      active: account.accountSource === 'claudeCode' ? account.id === claude : account.id === selected.id }));
    else if (command === 'list_providers' || command === 'list_aggregate_apis') result = [];
    else if (command === 'codex_gui_events') result = { cursor: { streamId: 'fixture', sequence: 0 }, events: [] };
    else if (command === 'claude_account_request') {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (fail) { await route.fulfill({ json: { ok: false, error: 'client.officialAccounts.authOverride' } }); return; }
      if (args.request.action === 'activate') claude = args.request.id;
    } else if (command === 'codex_gui_switch_account') { selected = args.selection; result = selected; }
    else if (command === 'cli_gui_request') result = args.request.action === 'status'
      ? { status: 'missing', engine: args.request.engine } : [];
    await route.fulfill({ json: { ok: true, result } });
  });
  return { calls, selection: () => selected, fail: () => { fail = true; } };
}

async function capture(page: Page, info: TestInfo, state: string) {
  if (state.startsWith('list-')) {
    await expect(page.getByRole('region', { name: '账户列表' })).toBeVisible();
    await expect.poll(() => page.locator('.ant-popover:visible').evaluateAll(elements =>
      elements.reduce((count, element) => count + element.getAnimations({ subtree: true }).length, 0))).toBe(0);
  }
  const filename = info.outputPath(`${state}.png`);
  await page.screenshot({ path: filename, animations: 'disabled' });
  await info.attach(state, { path: filename, contentType: 'image/png' });
}

for (const mode of ['local', 'remote', 'web']) for (const enlarged of [false, true]) {
  test(`${mode}: Claude defaults in unified list ${enlarged ? 'dark-font20-narrow' : 'light-font14'}`,
    async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const backend = await fixture(page);
      if (enlarged) await page.setViewportSize({ width: 900, height: 800 });
      await page.goto(`/e2e/unified-account-picker.html?mode=${mode}${enlarged ? '&dark&font=20' : ''}`);
      const trigger = page.getByRole('button', { name: /^切换 GUI 账户：/ });
      await expect(trigger).toContainText('codex@example.test');
      await trigger.click();
      const list = page.getByRole('region', { name: '账户列表' });
      const target = list.getByRole('button', { name: /claude2@example.test/ });
      await expect(target).toBeEnabled();
      await expect(target).toContainText('Claude Code · Pro');
      await expect(page.getByRole('button', { name: '管理 Claude Code 账户' })).toHaveCount(0);
      await capture(page, info, 'list-before');
      const beat = Number(await page.getByLabel('刷新次数').textContent());
      await target.click();
      await expect.poll(async () => Number(await page.getByLabel('刷新次数').textContent())).toBeGreaterThan(beat);
      await expect(page.getByText('已切换 Claude Code 默认账户，新建会话将使用此账户。已有会话仍保留原账户。')).toBeVisible();
      await page.getByRole('textbox', { name: '消息' }).fill('界面仍可输入');
      await trigger.click();
      await expect(list).toBeVisible();
      await expect(target).toHaveAttribute('aria-pressed', 'true');
      await expect(list.getByRole('button', { name: /claude1@example.test/ })).toHaveAttribute('aria-pressed', 'false');
      await expect(list.getByRole('button', { name: /codex@example.test/ })).toHaveAttribute('aria-pressed', 'true');
      await capture(page, info, 'list-switched');
      expect(backend.selection()).toEqual({ kind: 'account', id: 'codex' });
      expect(backend.calls.filter(call => call.command === 'claude_account_request')).toEqual([
        { command: 'claude_account_request', args: { request: { action: 'activate', id: secondId } } },
      ]);
      await page.keyboard.press('Escape');
      await page.locator('.cli-gui-engine').click();
      await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
      await expect(trigger).toContainText('claude2@example.test');
      await capture(page, info, 'claude-summary');
      expect(errors).toEqual([]);
    });
}

test('remote: failed Claude switch preserves both defaults and shows the actionable error', async ({ page }, info) => {
  const backend = await fixture(page);
  backend.fail();
  await page.goto('/e2e/unified-account-picker.html?mode=remote');
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  const list = page.getByRole('region', { name: '账户列表' });
  await list.getByRole('button', { name: /claude2@example.test/ }).click();
  await expect(page.getByRole('alert')).toContainText('Claude Code 仍配置了其他服务的登录信息');
  await expect(list.getByRole('button', { name: /claude1@example.test/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('button', { name: /claude2@example.test/ })).toHaveAttribute('aria-pressed', 'false');
  expect(backend.selection().id).toBe('codex');
  await capture(page, info, 'failed-switch');
});
