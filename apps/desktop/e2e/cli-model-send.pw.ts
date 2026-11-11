import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend } from './cli-gui-support';
import type { createCliGuiFixture } from './cli-gui-fixture';

type Fixture = ReturnType<typeof createCliGuiFixture>;
const evidence = resolve('../../.codex-tmp/cli-model-send/screenshots');

/** Keep the host's Codex catalog unchanged, as it is when native Claude is selected. */
function nativeCatalog(fixture: Fixture) {
  const model = (input: { engine: string; id?: string }) => input.engine === 'claude'
    ? input.id === 'claude-history' ? 'old-sonnet' : 'sonnet' : 'plain-model';
  fixture.setCatalog(async input => {
    await new Promise(resolve => setTimeout(resolve, 400));
    return { status: 'ready', models: [{ id: model(input), label: model(input),
      defaultEffort: 'none', efforts: [] }], modes: [] };
  }, model);
}

async function choose(page: Page, name: string) {
  await page.locator('.cli-gui-engine:visible').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function installCatalog(page: Page, mode: string, fixture: Fixture) {
  if (mode === 'local') nativeCatalog(fixture);
  else {
    await page.waitForFunction(() => Boolean((window as unknown as { cliFixture?: Fixture }).cliFixture));
    await page.evaluate(nativeCatalog, await page.evaluateHandle(() =>
      (window as unknown as { cliFixture: Fixture }).cliFixture));
  }
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: native Claude, CLI switching, fixed old model and no reasoning send`, async ({ page }) => {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 980 });
    const fixture = await localBackend(page);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}`);
    await installCatalog(page, mode, fixture);
    const send = page.getByRole('button', { name: '发送消息', exact: true });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true })
      .fill('Check the normal Codex selection');
    await expect(send).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-codex-ready.png`) });
    await choose(page, 'Claude GUI');
    await input.fill('Check the native Claude account');
    await expect(send).toBeDisabled();
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'sonnet' })).toBeVisible();
    await expect(send).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-claude-native-ready.png`) });
    await choose(page, 'Gemini GUI');
    await input.fill('Check a model without reasoning options');
    await expect(send).toBeDisabled();
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'plain-model' })).toBeVisible();
    await expect(send).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-no-reasoning-ready.png`) });
    await choose(page, 'Claude GUI');
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText('README.md · 补充本地开发步骤')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-claude-native-sent.png`) });
    const calls = mode === 'local' ? fixture.calls : await page.evaluate(() =>
      (window as unknown as { cliFixture: Fixture }).cliFixture.calls);
    expect(calls).toContainEqual(expect.objectContaining({ action: 'create', model: 'sonnet' }));
    expect(calls.filter(call => call.action === 'send').every(call => call.effort === undefined)).toBe(true);
    const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.locator('[data-cli-thread="claude-history"] button').click();
    await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'old-sonnet' })).toBeVisible();
    await input.fill('Continue the fixed model conversation');
    await expect(send).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-claude-fixed-ready.png`) });
    await send.click();
    await expect(page.getByText('README.md · 补充本地开发步骤')).toBeVisible();
    await page.locator('[data-cli-thread="gemini-history"] button').click();
    await input.fill('Send without a reasoning parameter');
    await expect(send).toBeEnabled(); await send.click();
    await expect(page.getByText('README.md · 补充本地开发步骤')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: resolve(evidence, `${mode}-no-reasoning-sent.png`) });
    const finalCalls = mode === 'local' ? fixture.calls : await page.evaluate(() =>
      (window as unknown as { cliFixture: Fixture }).cliFixture.calls);
    expect(finalCalls).toContainEqual(expect.objectContaining({ action: 'send', model: 'old-sonnet' }));
    expect(finalCalls).toContainEqual(expect.objectContaining({ action: 'send', model: 'plain-model' }));
    expect(finalCalls.filter(call => call.action === 'send').every(call => call.effort === undefined)).toBe(true);
  });
}
