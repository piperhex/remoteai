import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

for (const width of [1440, 390]) test(`remote summary pauses, resumes, and switches ranges at ${width}px`,
  async ({ page }) => {
    const directory = '../../.codex-tmp/token-lifecycle';
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    await page.route('**/token-remote-fixture?*', async route => { requests++; await route.fulfill({ body: '{}' }); });
    await page.goto('/e2e/token-remote-harness.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2100);
    expect(requests).toBe(0);
    await page.getByRole('button', { name: 'Open summary' }).click();
    await expect(page.locator('.chat-token-card').first()).toBeVisible();
    await page.waitForTimeout(2100);
    expect(requests).toBeGreaterThanOrEqual(3);
    await page.getByRole('spinbutton').fill('3');
    await page.getByRole('button', { name: /^(应用|Apply)$/ }).click();
    await expect(page.getByRole('heading', { name: /周.*Token.*总消耗|weeks.*Total tokens/ })).toContainText('3');
    await page.screenshot({ path: `${directory}/after-web-remote-open-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: /^(关闭|关闭详情抽屉|Close|Close details)$/ }).last().click();
    await expect(page.locator('.chat-token-summary')).not.toBeAttached();
    const hidden = requests;
    await page.waitForTimeout(5100);
    expect(requests).toBe(hidden);
    await page.getByRole('button', { name: 'Open summary' }).click();
    await expect(page.locator('.chat-token-card').first()).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThan(hidden);
    await expect(page.getByRole('spinbutton')).toHaveValue('3');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${directory}/after-web-remote-reopened-${width}.png`, animations: 'disabled' });
    writeFileSync(`${directory}/remote-${width}.json`, JSON.stringify({ width, hiddenObservationMs: 5100,
      hiddenAdditionalRequests: 0, rangeRetained: 3, resumedRequests: requests - hidden,
      sourceHashes: Object.fromEntries(['../web/src/chat/ChatTokenSummary.tsx',
        '../../shared/token-usage/useWindowVisible.ts', '../../shared/token-usage/useDocumentVisible.ts'].map(path =>
        [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }));
  });
