import { test, expect } from '@playwright/test';

test('a backend history page loads asynchronously while preserving the reading position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/e2e/desktop-history-harness.html?paged');
  await expect(page.locator('[data-message-id]')).toHaveCount(10);
  await expect(page.locator('[data-message-id="message-1999"]')).toBeInViewport();
  const viewport = page.getByLabel('对话消息');
  await viewport.evaluate(node => { node.scrollTop = 0; });
  await expect(viewport.getByRole('status')).toContainText('正在加载更早的消息');
  const anchor = page.locator('[data-message-id="message-1990"]');
  const before = (await anchor.boundingBox())!.y;
  await expect(page.locator('[data-message-id]')).toHaveCount(20);
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(3);
  await expect(page.getByRole('button', { name: '加载更早的消息' })).toHaveCount(1);
  await page.screenshot({ path: '../../.artifacts/vm-performance-20261105/local-paged-history.png' });
  await viewport.evaluate(node => { node.scrollTop = 0; });
  await expect(viewport.getByRole('status')).toContainText('正在加载更早的消息');
  await page.getByRole('button', { name: '切换会话' }).click();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(viewport.getByRole('status')).toHaveCount(0);
});

test('loading an earlier backend page preserves an expanded process and its reading anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/e2e/desktop-history-harness.html?activity-history&paged');
  const process = page.locator('details').first();
  const summary = process.locator('summary');
  await summary.click();
  await process.evaluate(node => node.setAttribute('data-original-process', 'true'));
  const before = await summary.getAttribute('aria-label');
  await page.getByRole('button', { name: '加载更早的消息', exact: true }).click();
  await expect.poll(() => summary.getAttribute('aria-label')).not.toBe(before);
  await expect(process).toHaveAttribute('data-original-process', 'true');
  await expect(process).toHaveAttribute('open');
  await page.screenshot({ path: '../../.artifacts/vm-performance-20261105/local-paged-expanded.png' });
});
