import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CliEntry } from '../../../shared/cli-gui/types';
import type { createCliGuiFixture } from './cli-gui-fixture';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/native-memory/screenshots');
const entry = (seq: number, text: string): CliEntry => ({ id: String(seq), role: 'assistant', text, first: seq, last: seq });
const older = Array.from({ length: 400 }, (_, seq) => entry(seq, `Earlier response ${seq + 1}`));
const latest = [entry(400, 'Latest response from the computer')];
type FixtureWindow = Window & { cliFixture: ReturnType<typeof createCliGuiFixture> };

for (const mode of ['local', 'remote']) {
  test(`${mode} returns from a bounded older reading window to the live CLI conversation`, async ({ page }) => {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 850 });
    if (mode === 'local') await nativeShell(page);
    const fixture = await localBackend(page);
    if (mode === 'local') fixture.setHistory('claude', latest, 'idle', older);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('[data-cli-thread="claude-history"] button');
    await expect(row).toBeVisible({ timeout: 60_000 });
    if (mode !== 'local') await page.evaluate(({ entries, earlier }) =>
      (window as FixtureWindow).cliFixture.setHistory('claude', entries, 'idle', earlier), { entries: latest, earlier: older });
    await row.click();
    const pane = page.locator('.cli-gui-pane');
    await expect(pane.getByText(latest[0].text, { exact: true })).toBeVisible();
    await pane.getByRole('button', { name: '加载更早的消息', exact: true }).click();
    const jump = pane.getByRole('button', { name: mode === 'local' ? '回到最新消息' : '回到底部', exact: true });
    await expect(jump).toBeVisible();
    await expect(pane.getByText(latest[0].text, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(evidence, `desktop-${mode}-older-window.png`), animations: 'disabled' });
    await jump.click();
    await expect(pane.getByText(latest[0].text, { exact: true })).toBeInViewport();
    await page.screenshot({ path: resolve(evidence, `desktop-${mode}-latest.png`), animations: 'disabled' });
  });
}
