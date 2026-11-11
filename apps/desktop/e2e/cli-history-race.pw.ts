import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CliEntry, CliHistory, CliRequest } from '../../../shared/cli-gui/types';
import type { createCliGuiFixture } from './cli-gui-fixture';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/history-pagination/screenshots');
type FixtureWindow = Window & { cliFixture: ReturnType<typeof createCliGuiFixture> };
const entry = (first: number, text: string, last = first): CliEntry =>
  ({ id: String(first), first, last, role: 'assistant', text });

for (const mode of ['local', 'remote', 'web']) for (const engine of ['claude', 'gemini'] as const) {
  test(`${mode} ${engine}: delayed older page preserves the refreshed final reply`, async ({ page }) => {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 960 });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(90_000);
    if (mode === 'local') await nativeShell(page);
    const fixture = await localBackend(page);
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    let olderRequests = 0;
    const hold = async (result: CliHistory) => {
      olderRequests++;
      await gate;
      return { ...result, entries: [{ ...entry(1, 'Earlier discussion restored.'), role: 'user' },
        entry(10, 'Partial reply', 11)],
        cursor: { epoch: 'test', seq: 1 }, hasOlder: false };
    };
    if (mode === 'local') {
      await page.route('**/__codex_switch__/api/invoke', async route => {
        const { command, args } = route.request().postDataJSON();
        const request = args?.request as CliRequest | undefined;
        if (command !== 'cli_gui_request' || request?.action !== 'read' || !request.cursor) {
          await route.fallback(); return;
        }
        const result = await hold(await fixture.transport.request<CliHistory>(request));
        await route.fulfill({ json: { ok: true, result } });
      });
    } else {
      await page.exposeFunction('holdCliHistoryPage', hold);
      // Keep the real consumer and controller; delay only its fixture transport response.
      await page.route('**/e2e/cli-gui-harness.tsx*', async route => {
        const response = await route.fetch();
        const source = await response.text();
        const assignment = 'controller.cliGui.request = fixture.transport.request;';
        expect(source).toContain(assignment);
        await route.fulfill({ response, body: source.replace(assignment,
          `controller.cliGui.request = async request => {
            const result = await fixture.transport.request(request);
            return request.action === 'read' && request.cursor ? window.holdCliHistoryPage(result) : result;
          };`) });
      });
    }
    const update = async (items: CliEntry[], status: string) => {
      if (mode === 'local') fixture.setHistory(engine, items, status);
      else await page.evaluate(({ engine, items, status }) =>
        (window as FixtureWindow).cliFixture.setHistory(engine, items, status), { engine, items, status });
    };
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native`);
    const row = page.locator(`[data-cli-thread="${engine}-history"] button`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await update([entry(10, 'Partial reply', 11)], 'running');
    await row.click();
    const pane = page.locator('.cli-gui-pane');
    await expect(pane.getByText('Partial reply', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '加载更早的消息', exact: true }).click();
    await expect.poll(() => olderRequests).toBe(1);
    await update([entry(10, 'Final reply retained.', 13),
      { ...entry(14, 'New message retained.'), role: 'user' }], 'idle');
    await expect(pane.getByText('Final reply retained.', { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-refresh-before-page.png`),
      animations: 'disabled' });
    release();
    await expect(pane.getByText('Earlier discussion restored.', { exact: true })).toBeVisible();
    await expect(pane.getByText('Final reply retained.', { exact: true })).toHaveCount(1);
    await expect(pane.getByText('New message retained.', { exact: true })).toHaveCount(1);
    await expect(pane.getByText('Partial reply', { exact: true })).toHaveCount(0);
    await expect(pane.getByRole('alert')).toHaveCount(0);
    expect(olderRequests).toBe(1);
    await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-page-merged.png`), animations: 'disabled' });
  });
}
