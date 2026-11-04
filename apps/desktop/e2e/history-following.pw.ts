import { expect, test, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

function conversation(): Conversation {
  return { thread: { id: 'following', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: null, error: '', tokens: 0, turns: [{ id: 'turn', status: 'completed',
      items: Array.from({ length: 35 }, (_, index) => ({ id: `message-${index}`,
        type: 'agentMessage', phase: 'final_answer', text: `Message ${index}\n\n${'Readable history. '.repeat(20)}` })),
    }] };
}

async function openNearBothEdges(page: Page, width: number) {
  await page.setViewportSize({ width, height: 850 });
  await page.route('**/history-fixture.json', route => route.fulfill({ json: conversation() }));
  await page.goto('/e2e/tool-history-harness.html');
  const viewport = page.getByLabel('对话消息');
  await expect(page.locator('[data-message-id]')).toHaveCount(10);
  const overflow = await viewport.evaluate(node => node.scrollHeight - node.clientHeight);
  await page.setViewportSize({ width, height: 850 + overflow - 52 });
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBe(52);
  await viewport.hover({ position: { x: 10, y: 20 } });
  await page.mouse.wheel(0, -60);
  await expect(page.locator('[data-message-id]')).toHaveCount(20);
  return viewport;
}

for (const width of [1280, 1960]) {
  test(`history stays stable near both scroll edges at ${width}px`, async ({ page }, info) => {
    const viewport = await openNearBothEdges(page, width);
    const samples = await viewport.evaluate(async node => {
      const samples: { count: number; top: number; anchor: number | null }[] = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push({ count: node.querySelectorAll('[data-message-id]').length, top: node.scrollTop,
          anchor: node.querySelector('[data-message-id="message-25"]')?.getBoundingClientRect().top ?? null });
      }
      return samples;
    });
    expect([...new Set(samples.map(sample => sample.count))]).toEqual([20]);
    expect(new Set(samples.map(sample => sample.top)).size).toBe(1);
    expect(new Set(samples.map(sample => sample.anchor)).size).toBe(1);
    await page.getByLabel('消息', { exact: true }).fill('Keep typing while reading history');
    const top = await viewport.evaluate(node => node.scrollTop);
    const value = conversation();
    value.turns[0].items.push({ id: 'streamed', type: 'agentMessage', phase: 'final_answer',
      text: 'Streaming response.\n\n'.repeat(15) });
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail })), value);
    await expect(page.locator('[data-message-id]')).toHaveCount(21);
    expect(await viewport.evaluate(node => node.scrollTop)).toBe(top);
    // The tall fixture can pause following while less than half a viewport remains below it.
    const size = page.viewportSize()!;
    await page.setViewportSize({ ...size, height: 850 });
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await expect(page.locator('[data-message-id]')).toHaveCount(10);
    await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(2);
    await page.screenshot({ path: info.outputPath('stable-history.png') });
  });
}

test('scrolling down resumes live replies without reopening older pages', async ({ page }) => {
  const viewport = await openNearBothEdges(page, 1280);
  await page.mouse.wheel(0, 60);
  await expect(page.locator('[data-message-id]')).toHaveCount(10);
  const value = conversation();
  value.turns[0].items.push({ id: 'streamed', type: 'agentMessage', phase: 'final_answer',
    text: 'New reply.\n\n'.repeat(15) });
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail })), value);
  await expect(page.locator('[data-message-id]')).toHaveCount(10);
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(2);
  await expect(page.getByRole('button', { name: '回到最新消息', exact: true })).toHaveCount(0);
});

test('enlarging the window while reading history does not fetch or discard pages', async ({ page }) => {
  const viewport = await openNearBothEdges(page, 1280);
  const overflow = await viewport.evaluate(node => node.scrollHeight - node.clientHeight);
  const size = page.viewportSize()!;
  await page.setViewportSize({ ...size, height: size.height + overflow - 52 });
  const counts = await viewport.evaluate(async node => {
    const counts: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(requestAnimationFrame);
      counts.push(node.querySelectorAll('[data-message-id]').length);
    }
    return counts;
  });
  expect([...new Set(counts)]).toEqual([20]);
});
