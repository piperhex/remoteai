import { expect, test, type Route } from '@playwright/test';
import { officialUsageFixture } from './official-usage-fixture';

test('official quota stays responsive during polling on wide and narrow screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:token-usage-refresh-seconds', '1');
  });
  const fixture = officialUsageFixture();
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
  await expect(panel.getByText('18 / 30USD', { exact: true })).toBeVisible();
  await expect(panel.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '60');
  await expect(panel.getByRole('meter').nth(1)).toHaveAttribute('aria-valuenow', '0');
  await expect(panel.locator('.official-usage-account').nth(2).getByRole('meter')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: '../../.codex-tmp/official-usage/desktop-local-light-tokens.png' });
  await panel.getByText('消耗金额（USD）', { exact: true }).first().click();
  await expect(panel.locator('.official-usage-account').first()).toHaveAttribute('aria-label', 'studio@example.com');
  await panel.getByText('Token 消耗', { exact: true }).first().click();
  holdResponse = true;
  await page.clock.fastForward(60_000);
  await expect.poll(() => pending.length).toBe(1);
  await page.clock.fastForward(120_000);
  expect(pending).toHaveLength(1);
  await panel.getByRole('button', { name: '设备 · alex.chen@example.com' }).click();
  await expect(panel.getByRole('cell', { name: 'Office PC', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('heading')).toBeVisible();
  await expect(panel.getByText('18 / 30USD', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  holdResponse = false;
  fixture.accounts[0].remainingUsd = 24;
  fixture.accounts[0].primary = { ...fixture.accounts[0].primary!, consumedUsd: 8, capacityUsd: 40, remainingUsd: 24 };
  await pending[0].fulfill({ json: fixture });
  await expect(panel.getByText('24 / 40USD', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const scenario of [
  { name: 'dark-cost-details', width: 1440, fontSize: 14, theme: 'dark' },
  { name: 'narrow-enlarged-details', width: 800, fontSize: 20, theme: 'light' },
]) test(`official usage chart ${scenario.name}`, async ({ page }) => {
  await page.addInitScript(({ fontSize, theme }) => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:theme-mode', theme);
    localStorage.setItem('codex-switch:global-font-size', String(fontSize));
  }, scenario);
  await page.route('**/__test_official_usage', (route) => route.fulfill({ json: officialUsageFixture() }));
  await page.route(/\/src\/api\/officialUsage\.ts(?:\?|$)/, (route) => route.fulfill({
    contentType: 'text/javascript', body: 'export async function loadOfficialUsage() { '
      + 'return fetch("/__test_official_usage").then(response => response.json()); }',
  }));
  await page.setViewportSize({ width: scenario.width, height: 1100 });
  await page.goto('/#token-usage');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '官方账户跨设备用量' }) });
  await expect(panel.getByText('18 / 30USD', { exact: true })).toBeVisible();
  const chartSize = await panel.locator('.official-usage-chart').evaluate(node => getComputedStyle(node).fontSize);
  const controlSize = await panel.locator('.ant-segmented').evaluate(node => getComputedStyle(node).fontSize);
  expect(chartSize).toBe(controlSize);
  if (scenario.fontSize > 14) expect(Number.parseFloat(chartSize)).toBeGreaterThan(12);
  await panel.getByText('消耗金额（USD）', { exact: true }).first().click();
  await panel.getByRole('button', { name: '设备 · alex.chen@example.com' }).click();
  await expect(panel.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ animations: 'disabled', path: `../../.codex-tmp/official-usage/desktop-local-${scenario.name}.png` });
});

for (const scenario of [
  { name: 'light-tokens', width: 1280, fontSize: 14, dark: false },
  { name: 'dark-narrow-enlarged-details', width: 800, fontSize: 20, dark: true },
]) test(`remote official usage chart ${scenario.name}`, async ({ page }) => {
  await page.addInitScript(({ fontSize }) => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:global-font-size', String(fontSize));
  }, scenario);
  await page.route('**/token-remote-fixture?*', route => route.fulfill({ body: '{}' }));
  await page.setViewportSize({ width: scenario.width, height: 1000 });
  await page.goto(`/e2e/token-remote-harness.html${scenario.dark ? '?dark' : ''}`);
  await page.getByRole('button', { name: 'Open summary' }).click();
  const panel = page.locator('.chat-token-card').filter({ has: page.getByRole('heading', { name: '官方账户跨设备用量' }) });
  await expect(panel.getByText('18 / 30USD', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '设备 · alex.chen@example.com' }).click();
  await expect(panel.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: `../../.codex-tmp/official-usage/desktop-remote-${scenario.name}.png` });
  await panel.getByText('unused@example.com', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: `../../.codex-tmp/official-usage/desktop-remote-${scenario.name}-last-accounts.png` });
});
