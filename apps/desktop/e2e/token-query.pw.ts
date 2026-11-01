import { expect, test } from '@playwright/test';

test('uses one read across independent JS contexts and separates source, provider and range keys',
  async ({ context, page }) => {
    let requests = 0;
    await context.route('**/query-fixture?*', async route => {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({ json: { key: new URL(route.request().url()).searchParams.get('key'), requests } });
    });
    const second = await context.newPage();
    await Promise.all([page.goto('/e2e/token-query-harness.html'), second.goto('/e2e/token-query-harness.html')]);
    await Promise.all([page.waitForFunction(() => !!window.query), second.waitForFunction(() => !!window.query)]);
    const key = JSON.stringify(['computer-a', 'account-a', 100, 128000, 'provider-a']);
    const result = await Promise.all([page.evaluate(key => window.query(key, 60000), key),
      second.evaluate(key => window.query(key, 60000), key)]);
    expect(result[0]).toEqual(result[1]);
    expect(requests).toBe(1);
    for (const dimensions of [['computer-b', 'account-a', 100, 128000, 'provider-a'],
      ['computer-a', 'account-b', 100, 128000, 'provider-a'], ['computer-a', 'account-a', 200, 128000, 'provider-a'],
      ['computer-a', 'account-a', 100, 272000, 'provider-a'], ['computer-a', 'account-a', 100, 128000, 'provider-b']]) {
      const other = JSON.stringify(dimensions);
      expect(await second.evaluate(key => window.query(key, 60000), other)).toMatchObject({ key: other });
    }
    expect(requests).toBe(6);
    await second.evaluate(key => window.query(key, 0), key);
    expect(requests).toBe(7);
    await second.close();
  });

test('hosted account credentials isolate cached data and clearing credentials bypasses the old cache', async ({ page }) => {
  let requests = 0;
  await page.route('**/__codex_switch__/api/invoke', async route => {
    requests++;
    const command = route.request().postDataJSON().command;
    const provider = route.request().headers()['x-api-key'] ?? 'signed-out';
    await route.fulfill({ json: { ok: true, result: command === 'list_token_usage_entries'
      ? [{ id: 'fixture', ts: 1, provider, model: 'test', totalTokens: 5 }] : [] } });
  });
  await page.goto('/e2e/token-query-harness.html?hosted');
  await page.waitForFunction(() => !!window.dashboardQuery);
  for (const identity of ['account-a', 'account-b', '', 'account-a']) {
    const value = await page.evaluate(async identity => {
      if (identity) sessionStorage.setItem('codex-switch:hosted-web-api-key', identity);
      else sessionStorage.clear();
      return window.dashboardQuery(100, 128000);
    }, identity);
    expect(value).toMatchObject({ entries: [{ provider: identity || 'signed-out' }] });
  }
  expect(requests).toBe(16);
});

test('bounds shared IndexedDB entries and payload size', async ({ page }) => {
  await page.route('**/query-fixture?*', async route => {
    const key = new URL(route.request().url()).searchParams.get('key');
    await route.fulfill({ json: { value: key === 'oversized' ? 'x'.repeat(8 * 1024 * 1024) : key } });
  });
  await page.goto('/e2e/token-query-harness.html');
  await page.waitForFunction(() => !!window.query);
  for (let index = 0; index < 30; index++) await page.evaluate(key => window.query(key, 60000), `bounded-${index}`);
  await page.evaluate(() => window.query('oversized', 60000));
  const stored = await page.evaluate(() => new Promise<{ count: number; bytes: number; oversized: boolean }>(resolve => {
    const request = indexedDB.open('remoteai-token-queries-v1', 1);
    request.onsuccess = () => {
      const db = request.result;
      const all = db.transaction('results').objectStore('results').getAll();
      all.onsuccess = () => {
        const rows = all.result as Array<{ key: string; bytes: number }>;
        resolve({ count: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
          oversized: rows.some(row => row.key === 'oversized') });
        db.close();
      };
    };
  }));
  expect(stored.count).toBeLessThanOrEqual(24);
  expect(stored.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(stored.oversized).toBe(false);
});

test('does not publish or retain a response after its hosted identity changes', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/__codex_switch__/api/invoke', async route => {
    requests++;
    await pending;
    await route.fulfill({ json: { ok: true, result: [] } });
  });
  await page.goto('/e2e/token-query-harness.html?hosted');
  await page.waitForFunction(() => !!window.dashboardQuery);
  await page.evaluate(() => sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-a'));
  const reading = page.evaluate(() => window.dashboardQuery(100, 128000)
    .then(() => 'published', () => 'source-changed'));
  await expect.poll(() => requests).toBe(4);
  await page.evaluate(() => sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-b'));
  release();
  expect(await reading).toBe('source-changed');
  await page.evaluate(() => sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-a'));
  await page.evaluate(() => window.dashboardQuery(100, 128000));
  expect(requests).toBe(8);
});

test('a late older read cannot replace shared data when Web Locks are unavailable', async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await context.route('**/query-fixture?*', async route => {
    const value = ++requests;
    if (value === 1) await pending;
    await route.fulfill({ json: value });
  });
  const second = await context.newPage();
  const third = await context.newPage();
  await Promise.all([page, second, third].map(async target => {
    await target.goto('/e2e/token-query-harness.html');
    await target.waitForFunction(() => !!window.query);
  }));
  const reading = page.evaluate(() => window.query('fallback-race', 0));
  await expect.poll(() => requests).toBe(1);
  expect(await second.evaluate(() => window.query('fallback-race', 0))).toBe(2);
  release();
  expect(await reading).toBe(1);
  expect(await third.evaluate(() => window.query('fallback-race', 60000))).toBe(2);
  expect(requests).toBe(2);
});

test('rejects an old account response after switching away and back while it is pending', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/__codex_switch__/api/invoke', async route => {
    if (++requests <= 4) await pending;
    await route.fulfill({ json: { ok: true, result: [] } });
  });
  await page.goto('/e2e/token-query-harness.html?hosted');
  await page.waitForFunction(() => !!window.dashboardQuery);
  await page.evaluate(() => sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-a'));
  const old = page.evaluate(() => window.dashboardQuery(100, 128000)
    .then(() => 'published', () => 'source-changed'));
  await expect.poll(() => requests).toBe(4);
  await page.evaluate(async () => {
    sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-b');
    await window.dashboardQuery(100, 128000);
    sessionStorage.setItem('codex-switch:hosted-web-api-key', 'account-a');
  });
  const latest = page.evaluate(() => window.dashboardQuery(100, 128000));
  // New A waits for the old A Web Lock. Release only after its new generation has entered the service.
  await page.waitForFunction(async () => (await navigator.locks.query()).pending?.length === 1);
  release();
  expect(await old).toBe('source-changed');
  expect(await latest).toMatchObject({ entries: [], error: false });
  expect(requests).toBe(12);
});
