import type { Page } from '@playwright/test';
import { createCliGuiFixture, sidebarCodexThread, cliGitStatus } from './cli-gui-fixture';
import type { Thread } from '../../../shared/conversation/types';

export async function localBackend(page: Page, ready = true,
  options: { codexReady?: boolean; manualInstall?: boolean; threads?: Thread[] } = {}) {
  const fixture = createCliGuiFixture(ready, options);
  const modelRequests: { cacheOnly?: boolean }[] = [];
  const commands: string[] = [];
  const events: { name: string; payload: unknown }[] = [];
  fixture.accounts.subscribe(() => events.push({ name: 'codex-gui-account-changed', payload: {} }));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    commands.push(command);
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
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: events.length },
      reset: false, events: events.slice(args.cursor?.sequence ?? 0) };
    if (command === 'codex_gui_model_settings') result = { threadId: null, selection: null, revision: 0 };
    if (command === 'codex_gui_request') {
      let data: unknown = { data: [], nextCursor: null };
      if (args.request.operation === 'list') data = {
        data: options.threads ? (args.request.archived ? [] : options.threads) : [sidebarCodexThread], nextCursor: null };
      if (['read', 'resume'].includes(args.request.operation)) data = {
        thread: options.threads?.find(thread => thread.id === args.request.threadId) ?? sidebarCodexThread };
      if (args.request.operation === 'models') {
        modelRequests.push(args.request);
        data = { data: fixture.models(), nextCursor: null };
      }
      if (args.request.operation === 'plugins') data = { marketplaces: [], marketplaceLoadErrors: [] };
      if (args.request.operation === 'recoveryList') data = { batchId: 'fixture-empty', candidates: [] };
      result = { data };
    }
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    await route.fulfill({ json: { ok: true, result } });
  });
  return { ...fixture, modelRequests, commands };
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
