import { expect, test } from '@playwright/test';

for (const mode of ['desktop-local', 'hosted-web'] as const) {
  test(`${mode}: interaction and polling continue while cloud sync is pending`, async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let syncCalls = 0;
    let polls = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const invoke = async (command: string): Promise<unknown> => {
      if (command === 'cloud_sync_accounts') { syncCalls++; await gate; return { uploaded: 0, downloaded: 0 }; }
      if (command === 'get_cloud_auth_state') return { enabled: true, authenticated: true, userId: 'fixture' };
      if (command === 'list_accounts') return [];
      if (command === 'get_app_info') return { version: 'test', codexHome: 'C:/fixture' };
      if (command === 'get_proxy_session_unlimited_conversation') return false;
      if (command === 'list_proxy_sessions') {
        polls++;
        return [{ id: 'active', client: 'codex_switch_gui', connectedAt: 1, lastSeenAt: 1,
          activeRequests: 1, requestCount: polls, totalTokens: 0, inputTokens: 0,
          outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }];
      }
      return 1;
    };
    if (mode === 'desktop-local') {
      await page.exposeFunction('credentialFixtureInvoke', invoke);
      await page.addInitScript(() => {
        Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
          invoke: (command: string) => Reflect.get(window, 'credentialFixtureInvoke')(command),
          transformCallback: () => 1, unregisterCallback: () => {},
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        } });
      });
    } else {
      await page.route('**/__codex_switch__/api/invoke', async route => {
        const { command } = route.request().postDataJSON() as { command: string };
        await route.fulfill({ json: { ok: true, result: await invoke(command) } });
      });
    }
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    try {
      await page.goto('/e2e/responsiveness-harness.html');
      await page.evaluate(async () => {
        const modulePath = '/src/api/backend.ts';
        const api = await import(/* @vite-ignore */ modulePath);
        document.body.dataset.cloudSync = 'pending';
        void api.invoke('cloud_sync_accounts').then(() => { document.body.dataset.cloudSync = 'done'; });
        const state = await api.invoke('get_cloud_auth_state');
        document.body.dataset.authenticated = String(state.authenticated);
      });
      await expect.poll(() => syncCalls).toBe(1);
      await expect(page.locator('body')).toHaveAttribute('data-authenticated', 'true');
      await page.getByLabel('Draft').fill('Editing during a slow cloud sync');
      for (let count = 0; count < 5; count++) {
        await page.getByRole('button', { name: `Click ${count}`, exact: true }).click({ timeout: 2_000 });
      }
      await expect.poll(() => polls).toBeGreaterThanOrEqual(3);
      await expect(page.locator('body')).toHaveAttribute('data-cloud-sync', 'pending');
      await page.screenshot({ path: `../../.codex-tmp/task-b-${mode}-cloud-pending.png` });
      release();
      await expect(page.locator('body')).toHaveAttribute('data-cloud-sync', 'done');
      await expect(page.getByLabel('Draft')).toHaveValue('Editing during a slow cloud sync');
      expect(errors).toEqual([]);
      console.info({ mode, syncCalls, polls });
    } finally { release(); }
  });
}
