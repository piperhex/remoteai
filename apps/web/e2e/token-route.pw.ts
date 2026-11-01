import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect, fixtureUrl, login, navigate, operationCount } from './chat-helpers';

test('independent token-summary route remains visible with chat inactive and pauses after returning',
  async ({ page, request }, info) => {
    await request.post(`${fixtureUrl}/test/reset`);
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await login(page);
    await connect(page);
    await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 16000 });
    await navigate(page, '发现');
    await page.locator('.discovery-list').getByRole('button', { name: 'Token 汇总', exact: true }).click();
    // App passes active={page === 'chat'} and tokenSummary={page === 'token-summary'} independently.
    await expect(page.locator('.chat-page')).toBeHidden();
    await expect(page.locator('.chat-token-summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: '每日 Token 趋势' })).toBeVisible();
    const range = page.getByRole('spinbutton', { name: '统计周数，1 至 52 周' });
    await range.fill('3');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.locator('.chat-token-card h3').first()).toContainText('3');
    await page.waitForTimeout(500);
    const prefix = `../../.codex-tmp/token-lifecycle/after-web-route-${info.project.name}`;
    await page.screenshot({ path: `${prefix}-open.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '返回上一层' }).click();
    await expect(page.getByRole('heading', { name: '发现', exact: true })).toBeVisible();
    await expect(page.locator('.chat-token-summary')).not.toBeAttached();
    const hiddenCount = await operationCount(request, 'tokenSummary');
    await page.waitForTimeout(5100);
    expect(await operationCount(request, 'tokenSummary')).toBe(hiddenCount);
    await page.screenshot({ path: `${prefix}-hidden.png`, animations: 'disabled' });
    await page.locator('.discovery-list').getByRole('button', { name: 'Token 汇总', exact: true }).click();
    await expect(page.locator('.chat-token-summary')).toBeVisible();
    await expect(range).toHaveValue('3');
    await expect.poll(() => operationCount(request, 'tokenSummary')).toBeGreaterThan(hiddenCount);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${prefix}-reopened.png`, animations: 'disabled' });
    writeFileSync(`${prefix}.json`, JSON.stringify({ route: 'token-summary', chatActive: false,
      hiddenObservationMs: 5100, hiddenAdditionalRequests: 0, reopenedRange: 3,
      sourceHashes: Object.fromEntries(['src/chat/ChatPage.tsx', 'src/chat/ChatTokenSummary.tsx',
        '../../shared/token-usage/useWindowVisible.ts', '../../shared/token-usage/useDocumentVisible.ts'].map(path =>
        [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }));
  });
