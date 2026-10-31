import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'hosted']) {
  test(`quota window sync saves, persists, and handles errors in ${mode}`, async ({ page }, info) => {
    let enabled = false;
    let fail = false;
    const saved: boolean[] = [];
    await page.addInitScript(selectedMode => {
      localStorage.setItem('codex-switch:language', 'zh');
      if (selectedMode === 'local') Object.assign(window, { __TAURI_INTERNALS__: {
        invoke: (command: string, args: unknown) => (window as unknown as {
          quotaSyncInvoke: (command: string, args: unknown) => Promise<unknown>;
        }).quotaSyncInvoke(command, args),
      } });
    }, mode);
    const invoke = async (command: string, args: { enabled?: boolean }) => {
      if (command === 'set_quota_window_sync_enabled') {
        if (fail) throw new Error('fixture save failure');
        enabled = Boolean(args.enabled);
        saved.push(enabled);
      }
      return { quotaWindowSyncEnabled: enabled };
    };
    await page.exposeFunction('quotaSyncInvoke', invoke);
    await page.route('**/__codex_switch__/api/invoke', async route => {
      const { command, args } = route.request().postDataJSON();
      try { await route.fulfill({ json: { ok: true, result: await invoke(command, args) } }); }
      catch { await route.fulfill({ json: { ok: false, error: 'fixture save failure' } }); }
    });
    await page.goto(`/e2e/quota-window-sync-harness.html?mode=${mode}`);
    const toggle = page.getByRole('switch', { name: '同步启动计时' });
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await page.screenshot({ path: info.outputPath(`${mode}-disabled.png`), animations: 'disabled' });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(() => saved).toEqual([true]);
    await page.reload();
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: info.outputPath(`${mode}-enabled.png`), animations: 'disabled' });
    fail = true;
    await toggle.click();
    await expect(page.getByRole('alert')).toContainText('设置保存失败');
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: info.outputPath(`${mode}-save-error.png`), animations: 'disabled' });
    fail = false;
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(saved).toEqual([true, false]);
  });
}

test('a failed settings load is disabled until retry succeeds', async ({ page }) => {
  let fail = true;
  await page.route('**/__codex_switch__/api/invoke', route => route.fulfill({
    json: fail ? { ok: false, error: 'fixture load failure' }
      : { ok: true, result: { quotaWindowSyncEnabled: true } },
  }));
  await page.goto('/e2e/quota-window-sync-harness.html');
  const toggle = page.getByRole('switch', { name: '同步启动计时' });
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('设置读取失败');
  fail = false;
  await page.getByRole('button', { name: /重\s*试/ }).click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
});

test('cloud web explains the per-computer setting', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('codex-switch.web.language.v1', 'zh'));
  await page.goto('/e2e/quota-window-sync-harness.html?mode=cloud');
  await page.getByRole('button', { name: '同步启动五小时计时' }).click();
  await expect(page.getByText(/每台电脑需单独设置/)).toBeVisible();
  await expect(page.locator('.ant-modal')).toHaveCSS('transform', 'none');
  await page.screenshot({ path: info.outputPath('cloud-web-guidance.png'), animations: 'disabled' });
});

test('all released languages render offline without raw keys', async ({ page }) => {
  await page.route(/^https:\/\//, route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', route => route.fulfill({
    json: { ok: true, result: { quotaWindowSyncEnabled: false } },
  }));
  for (const language of ['zh', 'en', 'ru', 'ja']) {
    await page.goto(`/e2e/quota-window-sync-harness.html?language=${language}`);
    await expect(page.getByRole('switch')).toBeEnabled();
    await expect(page.locator('main')).not.toContainText('settings.quotaWindowSync.');
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});
