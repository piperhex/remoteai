import { expect, test, type Page } from '@playwright/test';

const profile = { id: 'fixture', email: 'fixture@example.test', role: 'user' };
const device = { deviceId: 'fixture-pc', name: '本地测试电脑', platform: 'Windows', online: false,
  lastSeenAt: '2026-11-03T12:00:00Z', capabilities: [], localProxyRunning: false };

const state = (page: Page) => page.evaluate(async () => {
  const url = '/web/src/store.ts';
  const { store } = await import(/* @vite-ignore */ url);
  const current = store.getState();
  return { loading: current.data.loading, refreshing: current.data.refreshing,
    session: Boolean(current.auth.session), devices: current.data.devices.length };
});

test('initial login timeout retains the session and the real refresh entry recovers', async ({ page }, info) => {
  let stalled = true;
  let dashboardRequests = 0;
  await page.clock.install();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:1473') return route.abort();
    const path = url.pathname;
    if (path === '/auth/login') return route.fulfill({ json: {
      accessToken: 'fixture-access', refreshToken: 'fixture-refresh', user: profile,
    } });
    const responses: Record<string, unknown> = {
      '/auth/me': profile, '/sync/accounts/web-summary': { accounts: [] },
      '/devices': { devices: [device] }, '/devices/providers': { providers: [] },
    };
    if (path in responses) {
      dashboardRequests++;
      // An intercepted request left unanswered models a connection with no response.
      if (stalled) return;
      return route.fulfill({ json: responses[path] });
    }
    if (!path.startsWith('/web/') && !path.startsWith('/@')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.routeWebSocket(/device-switch|device-chat|lounge/, socket => socket.close());
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill(profile.email);
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-fixture');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await expect.poll(() => dashboardRequests).toBeGreaterThanOrEqual(4);
  await expect.poll(() => state(page)).toMatchObject({ loading: true, session: true });
  await page.clock.fastForward(30_001);
  await expect.poll(() => state(page)).toMatchObject({ loading: false, session: true });
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.clock.runFor(500);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-timeout-session-retained.png`),
    animations: 'disabled' });

  stalled = false;
  // Use the same Redux operation as the existing refresh controls.
  await page.evaluate(async () => {
    const url = '/web/src/store.ts';
    const { store, refreshAll, pageChanged } = await import(/* @vite-ignore */ url);
    await store.dispatch(refreshAll());
    store.dispatch(pageChanged('devices'));
  });
  await expect.poll(() => state(page)).toMatchObject({ loading: false, refreshing: false, session: true, devices: 1 });
  await page.clock.runFor(5_000);
  await expect(page.getByText('本地测试电脑', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${info.project.name}-refresh-recovered.png`), animations: 'disabled' });
});
