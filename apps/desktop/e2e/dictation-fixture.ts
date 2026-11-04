import type { Page } from '@playwright/test';
import { testModels } from '../../../shared/conversation/testing/models';
import type { Request, Thread } from '../../../shared/conversation/types';

const thread: Thread = { id: 'dictation-thread', name: '语音输入测试', cwd: '', preview: '', updatedAt: 1, turns: [] };
interface AudioRequest { sessionId: string; data: string; mimeType: string }
type Reply = { text: string } | { error: string };

export async function mockDictationBackend(page: Page) {
  const uploads: AudioRequest[] = [];
  const calls: Request[] = [];
  const replies: ((reply: Reply) => void)[] = [];
  const cancelled: string[] = [];
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'codex_gui_dictation_prepare') result = { sessionId: 'recording-session' };
    if (command === 'codex_gui_dictation_cancel') cancelled.push(args.sessionId);
    if (command === 'codex_gui_dictation_transcribe') {
      uploads.push(args.request);
      const reply = await new Promise<Reply>(resolve => replies.push(resolve));
      if ('error' in reply) {
        await route.fulfill({ json: { ok: false, error: reply.error } }); return;
      }
      result = reply;
    }
    if (command === 'codex_gui_cli_status') result = { version: '0.162.1' };
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_model_settings') result = { threadId: args.threadId ?? null,
      selection: { model: 'gpt-test', effort: 'high' }, revision: 0 };
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: 1 }, reset: false, events: [] };
    if (command === 'codex_gui_git') result = { cwd: '', branch: null, branches: [], changedFiles: 0, isWorktree: false };
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    if (command === 'codex_gui_request') {
      const request: Request = args.request;
      calls.push(request);
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === 'models') data = { data: testModels, nextCursor: null };
      if (request.operation === 'list') data = { data: [thread], nextCursor: null };
      if (request.operation === 'read' || request.operation === 'resume') data = { thread };
      if (request.operation === 'goals') data = { goals: [] };
      if (request.operation === 'goalGet') data = { goal: null };
      if (request.operation === 'plugins') data = { marketplaces: [], marketplaceLoadErrors: [] };
      if (request.operation === 'suggestNextPrompt') data = { suggestion: '' };
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return { uploads, calls, cancelled, reply: (reply: Reply) => replies.shift()?.(reply) };
}

export async function openDictation(page: Page, dark = false) {
  await page.goto('/e2e/gui-features-harness.html' + (dark ? '?dark' : ''));
  const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: thread.name, exact: true }).click();
  return page.getByRole('textbox', { name: '消息', exact: true });
}
