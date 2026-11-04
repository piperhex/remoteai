import { expect, test, type Page } from '@playwright/test';
import type { GuiEvent, Request, Thread, Turn } from '../../../shared/conversation/types';

const prompt = '请检查项目，暂停后保留这条消息。';
const thread: Thread = { id: 'new-chat', cwd: '', name: '暂停测试', preview: '', updatedAt: 1, turns: [] };
const turn: Turn = { id: 'first-turn', status: 'inProgress', items: [] };

async function mockBackend(page: Page) {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  let created = false;
  const events: { name: string; payload: GuiEvent }[] = [];
  const emit = (method: string, value: Turn) => events.push({ name: 'codex-gui-event',
    payload: { method, params: { threadId: thread.id, turn: value } } });
  const respond = (request: Request): unknown => {
    if (request.operation === 'models') return { data: [{ id: 'test-model', model: 'test-model',
      displayName: 'Test model', isDefault: true, defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }] }], nextCursor: null };
    if (request.operation === 'start') { created = true; return { thread }; }
    if (request.operation === 'send') { emit('turn/started', turn); return { turn }; }
    if (request.operation === 'interrupt') { emit('turn/completed', { ...turn, status: 'interrupted' }); return {}; }
    if (request.operation === 'list') return { data: created ? [thread] : [], nextCursor: null };
    if (request.operation === 'read' || request.operation === 'resume') return { thread };
    if (request.operation === 'plugins') return { marketplaces: [], marketplaceLoadErrors: [] };
    return { data: [], nextCursor: null };
  };
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'get_app_settings') result = { codexHomes: [] };
    if (command === 'codex_gui_cli_status') result = { version: '0.1.0' };
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_model_settings') result = { threadId: null, selection: null, revision: 0 };
    if (command === 'codex_gui_events') result = {
      cursor: { streamId: 'interrupted-send', sequence: 1 }, reset: false, events: events.splice(0),
    };
    if (command === 'codex_gui_request') result = { data: respond(args.request as Request) };
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    await route.fulfill({ json: { ok: true, result } });
  });
}

test('keeps the first local message after immediately stopping and reopening stale history', async ({ page }) => {
  await mockBackend(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/e2e/gui-features-harness.html', { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toBeEnabled();
  await input.fill(prompt);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续生成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: '暂停测试', exact: true }).click();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '继续生成', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.codex-tmp/interrupted-send-local.png', animations: 'disabled' });
});
