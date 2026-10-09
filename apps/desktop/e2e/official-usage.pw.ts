import { expect, test, type Route } from '@playwright/test';
import type { OfficialUsageSummary } from '../../../shared/officialUsage';

function usageFixture(): OfficialUsageSummary {
  const now = Math.floor(Date.now() / 1000);
  return { status: 'ready', updatedAt: now, accounts: [{
    accountId: 'workspace-personal', accountLabel: 'alex.chen@example.com', tokens: 2000000,
    costUsd: 6, remainingUsd: 18, secondary: null,
    primary: { capacityUsd: 30, remainingUsd: 18, consumedUsd: 6, declinePercent: 20,
      startPercent: 80, remainingPercent: 60, startTs: now - 200, endTs: now - 50 },
    devices: ['Office PC', 'Laptop'].map((deviceName, index) => ({ deviceId: String(index), deviceName,
      tokens: 1000000, costUsd: index ? 4 : 2, updatedAt: now })),
  }] };

}

test('official quota stays responsive during polling on wide and narrow screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:token-usage-refresh-seconds', '1');
  });
  const fixture = usageFixture();
  const pending: Route[] = [];
  let holdResponse = false;
  await page.clock.install();
  await page.route('**/__test_official_usage', async (route) => {
    if (holdResponse) { pending.push(route); return; }
    await route.fulfill({ json: fixture });
  });
  await page.route(/\/src\/api\/officialUsage\.ts(?:\?|$)/, (route) => route.fulfill({
    contentType: 'text/javascript', body: 'export async function loadOfficialUsage() { '
      + 'return fetch("/__test_official_usage").then(response => response.json()); }',
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#token-usage');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '官方账户跨设备用量' }) });
  await expect(panel.getByRole('cell', { name: '18/30USD', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: '30.00 USD', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: '6.00 USD', exact: true })).toBeVisible();
  holdResponse = true;
  await page.clock.fastForward(60_000);
  await expect.poll(() => pending.length).toBe(1);
  await page.clock.fastForward(120_000);
  expect(pending).toHaveLength(1);
  await panel.getByRole('button', { name: '展开行' }).click();
  await expect(panel.getByRole('cell', { name: 'Office PC', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('heading')).toBeVisible();
  await expect(panel.getByRole('cell', { name: '18/30USD', exact: true })).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  holdResponse = false;
  fixture.accounts[0].remainingUsd = 24;
  fixture.accounts[0].primary = { ...fixture.accounts[0].primary!, consumedUsd: 8, capacityUsd: 40, remainingUsd: 24 };
  await pending[0].fulfill({ json: fixture });
  await expect(panel.getByRole('cell', { name: '24/40USD', exact: true })).toBeAttached();
  expect(errors).toEqual([]);
});
