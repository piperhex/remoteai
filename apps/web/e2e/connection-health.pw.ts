import { expect, test } from '@playwright/test';

test('shows both public endpoints, wraps IPv6 and clears addresses on reconnect', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('e2e/connection-health-harness.html');
  const panel = page.locator('.connection-health');
  const endpoints = panel.locator('.connection-health-addresses');
  await expect(endpoints.getByText('本机公网 IP 和端口', { exact: true })).toBeVisible();
  await expect(endpoints.getByText('电脑公网 IP 和端口', { exact: true })).toBeVisible();
  await expect(endpoints).toContainText('203.0.113.8:42123 · UDP');
  await expect(endpoints).toContainText('[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535 · TCP');
  expect((await panel.locator('.connection-health-step').first().boundingBox())!.width).toBeLessThanOrEqual(400);
  expect(await endpoints.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await endpoints.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-endpoints.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(endpoints.getByText('尚未识别', { exact: true })).toHaveCount(2);
  await expect(endpoints).not.toContainText('203.0.113.8');
});

test('shows the selected P2P endpoints separately and hides them on relay', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('e2e/connection-health-harness.html?direct=1');
  const direct = page.getByRole('region', { name: '当前 P2P 连接' });
  await expect(direct).toContainText('192.168.1.4:45678 · UDP');
  await expect(direct).toContainText('[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535 · UDP');
  await expect(direct).not.toContainText('203.0.113.8');
  await expect(page.locator('.connection-health-public')).toContainText('203.0.113.8:42123 · UDP');
  expect((await direct.locator('dl > div').first().boundingBox())!.width).toBeLessThanOrEqual(400);
  expect(await direct.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await direct.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('p2p-endpoints.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(direct).toHaveCount(0);
  await expect(page.locator('.connection-health-public')).toContainText('203.0.113.8:42123 · UDP');
});

test('does not replace unavailable P2P addresses with discovered public candidates', async ({ page }) => {
  await page.goto('e2e/connection-health-harness.html?direct=1&unknown=1');
  const direct = page.getByRole('region', { name: '当前 P2P 连接' });
  await expect(direct.getByText('暂无法获取', { exact: true })).toHaveCount(2);
  await expect(direct).not.toContainText('203.0.113.8');
});

test('shows the peer-confirmed public mapping for the current P2P connection', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('e2e/connection-health-harness.html?direct=1&confirmed=1');
  const direct = page.getByRole('region', { name: '当前 P2P 连接' });
  await expect(direct.getByText('本机公网 IP 和端口', { exact: true })).toBeVisible();
  await expect(direct).toContainText('203.0.113.8:54321 · UDP');
  await expect(direct).not.toContainText('192.168.1.4');
  await expect(direct).not.toContainText('203.0.113.8:42123');
  expect((await direct.locator('dl > div').first().boundingBox())!.width).toBeLessThanOrEqual(400);
  expect(await direct.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await direct.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('confirmed-public-endpoint.png') });
});
