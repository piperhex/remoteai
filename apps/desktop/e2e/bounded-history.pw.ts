import { test, expect, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

function conversation(count: number): Conversation {
  return { thread: { id: 'bounded', cwd: '', preview: '', updatedAt: 1 }, activeTurn: null, error: '', tokens: 0,
    turns: Array.from({ length: count }, (_, index) => ({ id: `turn-${index}`, status: 'completed',
      items: [{ id: `message-${index}`, type: 'agentMessage', phase: 'final_answer',
        text: `Message ${index}\n\n${'A readable line of history. '.repeat(10)}` }],
    })) };
}
async function publish(page: Page, count: number) {
  await page.evaluate(value => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail: value })),
    conversation(count));
}

for (const width of [390, 1280]) {
  test(`bounds growing history and preserves a reading anchor across eviction at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/history-fixture.json', route => route.fulfill({ json: conversation(120) }));
    await page.goto('/e2e/tool-history-harness.html');
    const viewport = page.getByLabel('对话消息');
    const messages = page.locator('[data-message-id]');
    await expect(messages).toHaveCount(10);
    for (let count = 121; count <= 160; count++) await publish(page, count);
    await expect(messages).toHaveCount(10);
    await expect(page.locator('[data-message-id="message-159"]')).toBeInViewport();
    for (const count of [20, 30, 30, 30]) {
      const anchor = await viewport.evaluate(node => {
        node.scrollTop = 0;
        const first = node.querySelector<HTMLElement>('[data-message-id]')!;
        return { id: first.dataset.messageId!, top: first.getBoundingClientRect().top };
      });
      await expect.poll(() => messages.first().getAttribute('data-message-id')).not.toBe(anchor.id);
      await expect(messages).toHaveCount(count);
      await expect.poll(async () => page.locator(`[data-message-id="${anchor.id}"]`)
        .evaluate((node, top) => Math.abs(node.getBoundingClientRect().top - top), anchor.top)).toBeLessThan(3);
    }
    for (let index = 0; index < 2; index++) {
      const before = await messages.first().getAttribute('data-message-id');
      const anchor = await viewport.evaluate(node => {
        node.scrollTop = node.scrollHeight;
        const top = node.getBoundingClientRect().top;
        const visible = [...node.querySelectorAll<HTMLElement>('[data-message-id]')]
          .find(entry => entry.getBoundingClientRect().bottom > top)!;
        return { id: visible.dataset.messageId!, top: visible.getBoundingClientRect().top };
      });
      await expect.poll(() => messages.first().getAttribute('data-message-id')).not.toBe(before);
      await expect(messages).toHaveCount(30);
      await expect.poll(() => page.locator(`[data-message-id="${anchor.id}"]`)
        .evaluate((node, top) => Math.abs(node.getBoundingClientRect().top - top), anchor.top)).toBeLessThan(3);
    }
    const first = await messages.first().getAttribute('data-message-id');
    await publish(page, 240);
    await expect(messages).toHaveCount(30);
    expect(await messages.first().getAttribute('data-message-id')).toBe(first);
    await page.getByLabel('消息', { exact: true }).fill('持续输出时仍可输入');
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('持续输出时仍可输入');
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await expect(messages).toHaveCount(10);
    await expect(page.locator('[data-message-id="message-239"]')).toBeInViewport();
    await page.getByRole('button', { name: '离开对话' }).click();
    await publish(page, 300);
    await expect(messages).toHaveCount(0);
    await page.getByRole('button', { name: '返回对话' }).click();
    await expect(messages).toHaveCount(10);
    await expect(page.locator('[data-message-id="message-299"]')).toBeInViewport();
    await page.screenshot({ path: `../../.codex-tmp/bounded-history-${width}.png` });
  });
}
