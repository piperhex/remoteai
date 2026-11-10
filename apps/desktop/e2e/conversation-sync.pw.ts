import { expect, test } from '@playwright/test';

for (const path of ['relay', 'direct']) {
  test(`remote copy displays ${path} and measured speed`, async ({ page }) => {
    await page.goto(`/e2e/conversation-sync-harness.html?mode=remote&path=${path}&duplicates=1&hold=1`);
    await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
    await expect(page.getByText('排查项目中的登录问题')).toBeVisible();
    await expect(page.locator('.ant-select-selection-item').first()).toHaveText('Office PC · D:/work/.codex');
    await page.getByRole('checkbox').last().check();
    await page.getByRole('button', { name: '对话同步', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认同步对话？' });
    await expect(dialog).toContainText('远程目录中的原对话会保留');
    await expect(dialog).toContainText('目标已有 1 条对话。是否覆盖？');
    await dialog.getByRole('radio', { name: '覆盖已有对话', exact: true }).check();
    await expect(dialog).toHaveCSS('transform', 'none');
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../../.codex-tmp/conversation-sync-remote-${path}-overwrite.png`, animations: 'disabled' });
    const before = await page.evaluate(() => Reflect.get(window, 'syncCalls') as { request: { action: string } }[]);
    expect(before.some(call => call.request.action === 'read')).toBe(false);
    await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
    await expect(dialog.getByText(path === 'direct' ? 'P2P' : 'Relay', { exact: true })).toBeVisible();
    await expect.poll(async () => dialog.getByText(/KB\/s/).innerText()).not.toBe('0.0 KB/s');
    await expect(dialog.getByRole('button', { name: /开始同步/ })).toBeDisabled();
    await page.screenshot({ path: `../../.codex-tmp/conversation-sync-remote-${path}-progress.png`, animations: 'disabled' });
    await page.evaluate(() => { (Reflect.get(window, 'releaseSyncTransfer') as () => void)(); });
    await expect(dialog).toBeHidden();
    const calls = await page.evaluate(() => Reflect.get(window, 'syncCalls') as {
      host: string; request: { action: string; overwriteIds?: string[] } }[]);
    expect(calls.find(call => call.request.action === 'commit')?.request.overwriteIds).toEqual(['thread-sync']);
    expect(calls.filter(call => call.host === 'source').every(call =>
      ['homes', 'list', 'export', 'resume', 'read', 'close'].includes(call.request.action))).toBe(true);
  });
}

test('switching from Relay to P2P updates the progress display', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=remote&switchPath=1');
  await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
  await expect(page.getByText('排查项目中的登录问题')).toBeVisible();
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: '对话同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
  await expect(dialog.getByText('Relay', { exact: true })).toBeVisible();
  await expect(dialog.getByText('P2P', { exact: true })).toBeVisible();
});

for (const mode of ['local', 'remote']) {
  test(`${mode} sync fits an enlarged narrow desktop window`, async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 900 });
    await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&duplicates=1&font=20&dark=1`);
    await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
    await expect(page.getByText('排查项目中的登录问题')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);
    await page.screenshot({ path: `../../.codex-tmp/conversation-sync-${mode}-font20-narrow.png`, animations: 'disabled' });
    await page.getByRole('checkbox').last().check();
    await page.getByRole('button', { name: '对话同步', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('目标已有 1 条对话。是否覆盖？');
    await expect(dialog.getByRole('radio', { name: '跳过已有对话' })).toBeChecked();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(dialog).toHaveCSS('transform', 'none');
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../../.codex-tmp/conversation-sync-${mode}-font20-confirm.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('跳过 1 条');
    const calls = await page.evaluate(() => Reflect.get(window, 'syncCalls') as { request: { action: string } }[]);
    expect(calls.some(call => call.request.action === 'read')).toBe(false);
  });
}

test('English copy switches without exposing fallback keys or Relay limits', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=local&language=en');
  await expect(page.getByRole('button', { name: 'Conversation sync', exact: true })).toBeVisible();
  await expect(page.getByText(/client\.conversationSync\./)).toHaveCount(0);
  await expect(page.getByText(/200|不限速/)).toHaveCount(0);
});

test('remote transfer continues after dismissing the sync dialog', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=remote&hold=1');
  await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: '对话同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await dialog.getByRole('button', { name: '后台继续' }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => { (Reflect.get(window, 'releaseSyncTransfer') as () => void)(); });
  await expect.poll(async () => page.evaluate(() =>
    (Reflect.get(window, 'syncCalls') as { request: { action: string } }[])
      .filter(call => call.request.action === 'close').length)).toBe(2);
  const calls = await page.evaluate(() => Reflect.get(window, 'syncCalls') as { request: { action: string } }[]);
  expect(calls.some(call => call.request.action === 'commit')).toBe(true);
});
