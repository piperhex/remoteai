import type { Page } from '@playwright/test';
import { createCliGuiFixture, sidebarCodexThread, cliGitStatus } from './cli-gui-fixture';

export async function localBackend(page: Page, ready = true,
  options: { codexReady?: boolean; manualInstall?: boolean } = {}) {
  const fixture = createCliGuiFixture(ready, options);
  const modelRequests: { cacheOnly?: boolean }[] = [];
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'get_dream_skin_theme_preview') {
      result = '/src-tauri/resources/dream-skin/presets/preset-doraemon-ocean-submarine/background.jpg';
    }
    if (command === 'cli_gui_request') result = await fixture.transport.request(args.request);
    if (command === 'codex_gui_cli_status') result = { version: (options.codexReady ?? ready) ? '0.150.0' : null };
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_git') result = cliGitStatus(args.request.cwd);
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: 1 }, reset: false, events: [] };
    if (command === 'codex_gui_model_settings') result = { threadId: null, selection: null, revision: 0 };
    if (command === 'codex_gui_request') {
      let data: unknown = { data: [], nextCursor: null };
      if (args.request.operation === 'list') data = { data: [sidebarCodexThread], nextCursor: null };
      if (args.request.operation === 'read') data = { thread: sidebarCodexThread };
      if (args.request.operation === 'models') {
        modelRequests.push(args.request);
        data = { data: fixture.models(), nextCursor: null };
      }
      if (args.request.operation === 'plugins') data = { marketplaces: [], marketplaceLoadErrors: [] };
      result = { data };
    }
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    await route.fulfill({ json: { ok: true, result } });
  });
  return { ...fixture, modelRequests };
}

export async function nativeShell(page: Page) {
  await page.addInitScript(() => {
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const events = new Map<string, number[]>();
    Object.assign(window, { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: (event: unknown) => void) => {
        callbacks.set(++callbackId, callback); return callbackId;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'plugin:event|listen') {
          const name = String(args.event);
          events.set(name, [...events.get(name) ?? [], Number(args.handler)]); return ++callbackId;
        }
        if (command.startsWith('plugin:')) return null;
        const response = await fetch('/__codex_switch__/api/invoke', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, args }) });
        const body = await response.json();
        if (!body.ok) throw new Error(body.error);
        return body.result;
      },
    }, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    emitNativeTestEvent: (event: string, payload: unknown) => {
      events.get(event)?.forEach(id => callbacks.get(id)?.({ event, id, payload }));
    } });
  });
}
