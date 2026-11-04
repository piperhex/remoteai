import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

async function open(page: Page) {
  const value: Conversation = { thread: { id: 'scroll-bottom', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: null, error: '', tokens: 0, turns: [{ id: 'turn', status: 'completed', items: [{
      id: 'reply', type: 'agentMessage', phase: 'final_answer',
      text: Array.from({ length: 80 }, (_, index) => `Chat paragraph ${index + 1}.`).join('\n\n'),
    }] }] };
  await page.route('**/history-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('/e2e/tool-history-harness.html');
  await expect(page.locator('[data-message-id="reply"]')).toBeVisible();
  const viewport = page.getByLabel('对话消息');
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(2);
  return viewport;
}

async function leaveRemaining(viewport: Locator, remaining: number) {
  await viewport.evaluate((node, distance) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - distance;
    node.dispatchEvent(new Event('scroll'));
  }, remaining);
}

for (const height of [650, 1000]) {
  test(`shows the latest shortcut only beyond half the chat viewport at ${height}px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height });
    const viewport = await open(page);
    const button = page.getByRole('button', { name: '回到最新消息', exact: true });
    const threshold = await viewport.evaluate(node => node.clientHeight / 2);
    await leaveRemaining(viewport, Math.floor(threshold));
    await expect(button).toHaveCount(0);
    await leaveRemaining(viewport, Math.ceil(threshold) + 1);
    await expect(button).toBeVisible();
    await page.screenshot({ path: info.outputPath('above-threshold.png') });
    await leaveRemaining(viewport, Math.floor(threshold));
    await expect(button).toHaveCount(0);
    await leaveRemaining(viewport, Math.ceil(threshold) + 1);
    await button.click();
    await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(2);
    await expect(button).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('at-bottom.png') });
  });
}

test('refreshes the latest shortcut on content changes while keeping the reading position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  const viewport = await open(page);
  const button = page.getByRole('button', { name: '回到最新消息', exact: true });
  await leaveRemaining(viewport, 110);
  await expect(button).toHaveCount(0);
  const position = await viewport.evaluate(node => node.scrollTop);
  const reply = page.locator('[data-message-id="reply"]');
  await reply.evaluate(node => { (node as HTMLElement).style.paddingBottom = '500px'; });
  await expect(button).toBeVisible();
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(position);
  await reply.evaluate(node => { (node as HTMLElement).style.paddingBottom = ''; });
  await expect(button).toHaveCount(0);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(position);
});

test('rechecks the latest shortcut when the chat viewport grows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const viewport = await open(page);
  await leaveRemaining(viewport, 360);
  const button = page.getByRole('button', { name: '回到最新消息', exact: true });
  await expect(button).toBeVisible();
  const position = await viewport.evaluate(node => node.scrollTop);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(button).toHaveCount(0);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(position);
});
