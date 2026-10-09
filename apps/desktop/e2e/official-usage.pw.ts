import { expect, test } from '@playwright/test';
import type { OfficialUsageSummary } from '../../../shared/officialUsage';

function usageFixture(): OfficialUsageSummary {
  const now = Math.floor(Date.now() / 1000);
  return { status: 'ready', updatedAt: now, accounts: [{
    accountId: 'workspace-personal', accountLabel: 'alex.chen@example.com', tokens: 2000000,
    costUsd: 10, remainingUsd: 30, secondary: null,
    primary: { capacityUsd: 50, remainingUsd: 30, consumedUsd: 10, declinePercent: 20,
      startPercent: 80, remainingPercent: 60, startTs: now - 200, endTs: now - 50 },
    devices: ['Office PC', 'Laptop'].map((deviceName, index) => ({ deviceId: String(index), deviceName,
      tokens: 1000000, costUsd: index ? 7 : 3, updatedAt: now })),
  }] };

}

test('official account totals and USD estimate stay usable during polling on wide and narrow screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:token-usage-refresh-seconds', '1');
  });
  const fixture = usageFixture();
  await page.route(/\/src\/api\/officialUsage\.ts(?:\?|$)/, (route) => route.fulfill({
    contentType: 'text/javascript', body: `export async function loadOfficialUsage() { return ${JSON.stringify(fixture)}; }`,
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#token-usage');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '官方账户跨设备用量' }) });
  await expect(panel.getByRole('cell', { name: '$30.00', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: '$50.00', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: '$10.00', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '展开行' }).click();
  await expect(panel.getByRole('cell', { name: 'Office PC', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();
  const updated = page.getByText(/最近 \d+ 周 · 更新于/).first();
  const before = await updated.textContent();
  await expect(updated).not.toHaveText(before ?? '');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('heading')).toBeVisible();
  await expect(panel.getByRole('cell', { name: '$30.00', exact: true })).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
