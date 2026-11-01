import { expect, type Page } from '@playwright/test';
import type { Thread, Turn } from '../src/chat/types';

export const PAGE_SIZE = 60;
export function historyTurn(index: number): Turn {
  const text = `## 历史消息 ${index}\n\n` + '可变高度的历史内容，滚动后仍可完整阅读。'.repeat(Math.abs(index) % 4 + 1)
    + '\n\n```typescript\n'
    + Array.from({ length: Math.abs(index) % 8 + 2 }, (_, i) => `const value${i} = ${index + i};`).join('\n')
    + '\n```\n\n公式：$E = mc^2$。';
  return { id: `turn-${index}`, status: 'completed', items: [
    { id: `message-${index}`, type: 'agentMessage', phase: 'final_answer', text },
  ] };
}

export async function openHistory(page: Page, pages = 4) {
  await page.addInitScript(() => {
    const target = window as typeof window & { historyRichPeak: number };
    target.historyRichPeak = 0;
    new MutationObserver(() => {
      target.historyRichPeak = Math.max(target.historyRichPeak, document.querySelectorAll('.chat-markdown').length);
    }).observe(document, { childList: true, subtree: true });
  });
  let loaded = 0;
  const value: Thread = { id: 'bounded-history', cwd: '', preview: '', updatedAt: 1,
    turns: Array.from({ length: PAGE_SIZE }, (_, i) => historyTurn(pages * PAGE_SIZE + i)) };
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.route('**/display-history.json', async route => {
    loaded++;
    const turns = Array.from({ length: PAGE_SIZE }, (_, i) => historyTurn((pages - loaded) * PAGE_SIZE + i));
    value.turns = [...turns, ...value.turns!];
    await route.fulfill({ json: { turns, hasMore: loaded < pages } });
  });
  await page.goto(`e2e/chat-display-harness.html${pages ? '?history' : ''}`);
  await expect(page.locator('[data-message-id]')).toHaveCount(PAGE_SIZE);
  await expect(page.locator('.chat-markdown').last()).toContainText(`历史消息 ${(pages + 1) * PAGE_SIZE - 1}`);
  return { value, loaded: () => loaded };
}

export async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
}

export async function scrollToMessage(page: Page, id: string) {
  await page.locator(`[data-message-id="${id}"]`).evaluate(node => node.scrollIntoView({ block: 'start' }));
  await settle(page);
  await expect(page.locator(`[data-message-id="${id}"] .chat-markdown`)).toBeVisible();
}

export async function metrics(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  const heap = await session.send('Runtime.getHeapUsage');
  await session.detach();
  return page.evaluate(heapBytes => ({ heapBytes, rows: document.querySelectorAll('[data-message-id]').length,
    rich: document.querySelectorAll('.chat-markdown').length,
    peakRich: (window as typeof window & { historyRichPeak: number }).historyRichPeak,
    placeholders: document.querySelectorAll('[data-mobile-history-content="placeholder"]').length,
    nodes: document.querySelectorAll('*').length,
  }), heap.usedSize);
}
