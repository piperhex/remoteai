import type { BrowserContext } from '@playwright/test';
import type { GuiEvent, Thread } from '../../../shared/conversation/types';

export function titleBackend(settingsStatus = 200) {
  let settings = { model: 'admin-title-model', effort: 'medium' };
  let settingsReads = 0;
  let sequence = 0;
  const titleRequests: Record<string, unknown>[] = [];
  const pending: { id: string; resolve: (title: string | null) => void }[] = [];
  const events: { name: string; payload: GuiEvent }[] = [];
  const threads = new Map<string, Thread>();
  const usage: (() => void)[] = [];
  const notify = (payload: GuiEvent) => events.push({ name: 'codex-gui-event', payload });
  async function request(input: Record<string, unknown>) {
    const id = String(input.threadId);
    if (input.operation === 'models') return { data: [{ id: 'chat-model', model: 'chat-model',
      displayName: 'Chat Model', isDefault: true, defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] }], nextCursor: null };
    if (input.operation === 'list') return { data: [...threads.values()], nextCursor: null };
    if (input.operation === 'start') {
      const thread: Thread = { id: `thread-${++sequence}`, cwd: '', preview: '', updatedAt: sequence, turns: [] };
      threads.set(thread.id, thread);
      notify({ method: 'thread/started', params: { thread } });
      return { thread };
    }
    const thread = threads.get(id)!;
    if (input.operation === 'read' || input.operation === 'resume') return { thread };
    if (input.operation === 'send') {
      thread.preview = String(input.text);
      const turn = { id: `turn-${id}`, status: 'inProgress', items: [] };
      thread.turns = [turn];
      notify({ method: 'turn/started', params: { threadId: id, turn } });
      notify({ method: 'item/completed', params: { threadId: id, turnId: turn.id,
        item: { id: `question-${id}`, type: 'userMessage', content: [{ type: 'text', text: thread.preview }] } } });
      return { turn };
    }
    if (input.operation === 'generateTitle') {
      titleRequests.push(input);
      const title = await new Promise<string | null>((resolve) => pending.push({ id, resolve }));
      if (title && !thread.name) {
        thread.name = title;
        notify({ method: 'thread/name/updated', params: { threadId: id, threadName: title } });
        return { title };
      }
      return { title: null };
    }
    return {};
  }
  async function attach(context: BrowserContext) {
    await context.route('https://title-config.test/chat/title-settings', (route) => {
      settingsReads += 1;
      return route.fulfill({ status: settingsStatus, json: settings, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await context.route('**/__codex_switch__/api/invoke', async (route) => {
      const { command, args = {} } = route.request().postDataJSON();
      let result: unknown = {};
      if (command === 'fetch_cloud_title_settings') {
        settingsReads += 1;
        if (settingsStatus !== 200) return route.fulfill({ json: { ok: false, error: 'Title settings unavailable' } });
        result = settings;
      }
      if (command === 'get_cloud_auth_state') result = { baseUrl: 'https://title-config.test' };
      if (command === 'codex_gui_connect') result = [];
      if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
      if (command === 'codex_gui_queue_save') result = args.snapshot;
      if (command === 'codex_gui_model_settings') result = { threadId: args.threadId ?? null, selection: null, revision: 0 };
      if (command === 'codex_gui_set_model_settings') result = {
        threadId: args.threadId ?? null, selection: args.selection, revision: 1,
      };
      if (command === 'codex_gui_request') result = { data: await request(args.request) };
      if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: events.length },
        reset: false, events: args.cursor ? events.slice(args.cursor.sequence) : [] };
      if (command === 'codex_gui_usage_summary') {
        await new Promise<void>((resolve) => usage.push(resolve));
        result = { totalTokens: 123, estimatedCostUsd: 0 };
      }
      await route.fulfill({ json: { ok: true, result } });
    });
  }
  return { attach, titleRequests, reads: () => settingsReads,
    configure: (value: typeof settings) => { settings = value; },
    finish: (title: string | null) => pending.shift()?.resolve(title),
    release: () => { pending.splice(0).forEach(({ resolve }) => resolve(null)); usage.splice(0).forEach((done) => done()); } };
}
