import { expect, test } from '@playwright/test';

test('recovers a missed failed command completion without leaving a running header or refresh timer',
  async ({ page }, info) => {
    const local = info.project.name === 'desktop-local';
    const mobile = info.project.name === 'web-mobile';
    const mode = local ? 'local' : info.project.name === 'desktop-remote' ? 'remote' : 'web';
    let failed = false;
    let requests = 0;
    const response = () => {
      requests++;
      return { item: { id: 'command', type: 'commandExecution', command: 'npm test',
        cwd: 'F:/projects/example', status: failed ? 'failed' : 'inProgress',
        aggregatedOutput: failed ? 'Command failed: configuration validation did not pass.' : 'Checking configuration…',
        exitCode: failed ? 1 : null, durationMs: failed ? 15_000 : null } };
    };
    await page.route('**/deferred-tool-details-response', route => route.fulfill({ json: response() }));
    await page.route('**/__codex_switch__/api/invoke', route => route.fulfill({
      json: { ok: true, result: { data: response() } },
    }));
    for (const dark of [false, true]) {
      failed = false;
      await page.setViewportSize({ width: mobile ? 390 : dark ? 960 : 1280, height: 900 });
      await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)),
        dark ? 20 : 14);
      await page.goto(`deferred-tool-details-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
      const toggle = page.locator(local ? 'summary' : '.chat-activity').first();
      await expect(toggle).toContainText('正在运行');
      await toggle.click();
      await expect(page.getByText('Checking configuration…', { exact: true })).toBeVisible();
      const appearance = dark ? 'dark-narrow' : 'light';
      const evidence = `../../.codex-tmp/command-status-evidence/${info.project.name}-${appearance}`;
      await page.screenshot({ path: `${evidence}-running.png` });
      failed = true;
      await expect(toggle).toContainText('运行失败');
      await expect(page.getByText(/退出码.*1/)).toBeVisible();
      await expect(page.locator('[data-status="inProgress"], .is-running')).toHaveCount(0);
      const finalRequests = requests;
      await page.waitForTimeout(1200);
      expect(requests).toBe(finalRequests);
      await page.screenshot({ path: `${evidence}-failed.png` });
      await toggle.click();
      await expect(toggle).toContainText('运行失败');
      await expect(page.locator('.cs-command-output, .chat-virtual-command')).toHaveCount(0);
      await page.screenshot({ path: `${evidence}-collapsed.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

test('shows the routed command summary while running and requests no collapsed details', async ({ page }, info) => {
  const local = info.project.name === 'desktop-local';
  const mode = local ? 'local' : info.project.name === 'desktop-remote' ? 'remote' : 'web';
  const details: string[] = [];
  page.on('request', request => {
    if (request.url().includes('deferred-tool-details-response') || request.postData()?.includes('toolDetails')) {
      details.push(request.url());
    }
  });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  await page.goto(`deferred-tool-details-harness.html?mode=${mode}&routed`);
  const text = local ? page.locator('summary > span').first() : page.locator('.chat-activity-text');
  await expect(text).toContainText('npm test -- --runInBand');
  const payload = await page.evaluate(() => JSON.parse(document.documentElement.dataset.routedPayload!));
  expect(payload.status).toBe('inProgress');
  expect(payload.command).toBeUndefined();
  expect(payload.aggregatedOutput).toBeUndefined();
  await page.waitForTimeout(1200);
  expect(details).toEqual([]);
  await page.screenshot({ path: `../../.codex-tmp/running-command-summary-${info.project.name}.png` });
});

test('running activity text stays readable without continuous text animation', async ({ page }, info) => {
  const local = info.project.name === 'desktop-local';
  const mode = local ? 'local' : info.project.name === 'desktop-remote' ? 'remote' : 'web';
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  for (const dark of [false, true]) {
    await page.goto(`deferred-tool-details-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
    const text = local ? page.locator('summary > span').first() : page.locator('.chat-activity-text');
    await expect(text).toContainText('npm test');
    await expect(text).toHaveCSS('animation-name', 'none');
    await expect(text).toHaveCSS('background-image', 'none');
    expect(await text.evaluate(node => getComputedStyle(node).color)).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `../../.codex-tmp/static-activity-${info.project.name}-${dark ? 'dark' : 'light'}.png` });
  }
});

test('loads only expanded command details, updates the final result, and stops on collapse', async ({ page }, info) => {
  const local = info.project.name === 'desktop-local';
  const mode = local ? 'local' : info.project.name === 'desktop-remote' ? 'remote' : 'web';
  const outputView = page.locator('.cs-command-output, .chat-virtual-command:not(.is-command)');
  let count = 0;
  let fail = false;
  let releaseDetails!: () => void;
  const detailsReady = new Promise<void>(resolve => { releaseDetails = resolve; });
  let output = 'PASS: 128 tests\n中文输出完整显示\n' + 'test passed\n'.repeat(80);
  const respond = async (body: Record<string, unknown>) => {
    expect(body).toEqual({ operation: 'toolDetails', threadId: 'chat', turnId: 'turn', itemId: 'command' });
    count++;
    await detailsReady;
    return { item: { id: 'command', type: 'commandExecution', command: 'npm test -- --runInBand',
      cwd: 'F:/projects/example', status: 'inProgress', aggregatedOutput: output } };
  };
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  await page.route('**/deferred-tool-details-response', async route => {
    if (fail) { count++; await route.fulfill({ status: 503, body: '' }); return; }
    await route.fulfill({ json: await respond(JSON.parse(route.request().postData()!)) });
  });
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args } = route.request().postDataJSON();
    expect(command).toBe('codex_gui_request');
    if (fail) { count++; await route.fulfill({ json: { ok: false, error: 'Fixture unavailable' } }); return; }
    await route.fulfill({ json: { ok: true, result: { data: await respond(args.request) } } });
  });
  await page.goto(`deferred-tool-details-harness.html?mode=${mode}`);
  const toggle = local ? page.locator('summary').first() : page.locator('.chat-activity').first();
  await expect(toggle).toContainText('npm test');
  await page.waitForTimeout(1200);
  expect(count).toBe(0);
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-collapsed.png` });
  await toggle.click();
  await expect(page.locator('[role="status"]')).toContainText('加载');
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-loading.png` });
  releaseDetails();
  await expect(outputView).toContainText('PASS: 128 tests');
  expect(count).toBeGreaterThan(0);
  const beats = Number(await page.getByLabel('heartbeat').textContent());
  await page.waitForTimeout(1100);
  expect(Number(await page.getByLabel('heartbeat').textContent())).toBeGreaterThan(beats + 10);
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-expanded.png` });
  output = 'FINAL: all tests passed';
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('deferred-tool-details-update', { detail: { status: 'completed' } })));
  await expect(outputView).toContainText('FINAL: all tests passed');
  const completedCount = count;
  await page.waitForTimeout(1200);
  expect(count).toBe(completedCount);
  await toggle.click();
  await expect(outputView).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(count).toBe(completedCount);
  fail = true; await toggle.click();
  await expect(page.locator('[role="status"] button')).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-error.png` });
  fail = false; await page.locator('[role="status"] button').click();
  await expect(outputView).toContainText('FINAL: all tests passed');
  await page.setViewportSize({ width: info.project.name === 'web-mobile' ? 390 : 900, height: 900 });
  await page.goto(`deferred-tool-details-harness.html?mode=${mode}&dark`);
  await toggle.click();
  await expect(outputView).toContainText('FINAL: all tests passed');
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-dark-narrow-expanded.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
