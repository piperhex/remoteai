import { expect, test } from '@playwright/test';

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
  await expect(page.locator('.cs-command-output')).toContainText('PASS: 128 tests');
  expect(count).toBeGreaterThan(0);
  const beats = Number(await page.getByLabel('heartbeat').textContent());
  await page.waitForTimeout(1100);
  expect(Number(await page.getByLabel('heartbeat').textContent())).toBeGreaterThan(beats + 10);
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-expanded.png` });
  output = 'FINAL: all tests passed';
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('deferred-tool-details-update', { detail: { status: 'completed' } })));
  await expect(page.locator('.cs-command-output')).toContainText('FINAL: all tests passed');
  const completedCount = count;
  await page.waitForTimeout(1200);
  expect(count).toBe(completedCount);
  await toggle.click();
  await expect(page.locator('.cs-command-output')).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(count).toBe(completedCount);
  fail = true; await toggle.click();
  await expect(page.locator('[role="status"] button')).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-light-error.png` });
  fail = false; await page.locator('[role="status"] button').click();
  await expect(page.locator('.cs-command-output')).toContainText('FINAL: all tests passed');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`deferred-tool-details-harness.html?mode=${mode}&dark`);
  await toggle.click();
  await expect(page.locator('.cs-command-output')).toContainText('FINAL: all tests passed');
  await page.screenshot({ path: `../../.codex-tmp/deferred-tool-details-${info.project.name}-dark-narrow-expanded.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
