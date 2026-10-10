import { expect, test, type Page } from '@playwright/test';
import type { Thread } from '../src/chat/types';

function threads(start: number, count: number, grouped = false): Thread[] {
  return Array.from({ length: count }, (_, index) => ({ id: `chat-${start + index}`,
    name: `聊天 ${start + index}`, preview: '', updatedAt: 1, cwd: grouped ? '/project' : `/project-${start + index}` }));
}

async function scrollDown(page: Page, touch: boolean) {
  const list = page.locator('.chat-thread-list');
  const box = (await list.boundingBox())!;
  const x = box.x + box.width / 2;
  if (!touch) {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.wheel(0, box.height);
    return;
  }
  const session = await page.context().newCDPSession(page);
  try {
    const start = box.y + box.height - 30;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 8; step++) {
      const y = start - (box.height - 60) * step / 8;
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

test('loads once near the bottom using a mouse wheel or phone touch and preserves the reading position',
  async ({ page, isMobile }) => {
    let requests = 0;
    let finish = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/thread-page?*', async route => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (!cursor) return route.fulfill({ json: { data: threads(0, 12), nextCursor: 'next' } });
      requests++;
      await pending;
      await route.fulfill({ json: { data: threads(12, 12), nextCursor: null } });
    });
    await page.goto('./e2e/thread-pagination-harness.html');
    await expect(page.locator('.chat-thread')).toHaveCount(12);
    await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
    expect(requests).toBe(0);
    for (let step = 0; step < 6 && requests === 0; step++) await scrollDown(page, isMobile);
    await expect(page.getByRole('status')).toHaveText('正在加载…');
    for (let step = 0; step < 3; step++) await scrollDown(page, isMobile);
    expect(requests).toBe(1);
    const list = page.locator('.chat-thread-list');
    await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
    const position = await list.evaluate(node => node.scrollTop);
    finish();
    await expect(page.locator('.chat-thread')).toHaveCount(24);
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await list.evaluate(node => node.scrollTop)).toBe(position);
    await scrollDown(page, isMobile);
    expect(requests).toBe(1);
  });

test('fills a short collapsed list across pages and stops when there are no more chats', async ({ page }) => {
  const cursors: string[] = [];
  await page.route('**/thread-page?*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor') ?? '';
    cursors.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    await route.fulfill({ json: { data: threads(start, 6, true), nextCursor: start < 12 ? String(start + 6) : null } });
  });
  await page.goto('./e2e/thread-pagination-harness.html');
  await expect.poll(() => cursors).toEqual(['', '6', '12']);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.chat-thread')).toHaveCount(5);
  await page.getByRole('button', { name: '展开显示：project' }).click();
  await expect(page.locator('.chat-thread')).toHaveCount(18);
});

test('pauses automatic loading after failure and retries the same page on request', async ({ page }) => {
  let attempts = 0;
  await page.route('**/thread-page?*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (!cursor) return route.fulfill({ json: { data: threads(0, 1), nextCursor: 'next' } });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503 });
    await route.fulfill({ json: { data: threads(1, 1), nextCursor: null } });
  });
  await page.goto('./e2e/thread-pagination-harness.html');
  await page.getByRole('button', { name: '加载失败，点击重试' }).click();
  await expect(page.locator('.chat-thread')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '加载失败，点击重试' })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('coalesces background list updates while keeping chats visible and shows progress on manual refresh',
  async ({ page }) => {
    let requests = 0;
    let finish = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/thread-page?*', async route => {
      requests++;
      if (requests === 2) await pending;
      await route.fulfill({ json: { data: threads(0, 6, true), nextCursor: null } });
    });
    await page.goto('./e2e/thread-pagination-harness.html');
    await expect(page.locator('.chat-thread')).toHaveCount(5);
    const refresh = page.getByRole('button', { name: '刷新聊天', exact: true });
    await expect(refresh).toBeEnabled();
    await page.evaluate(() => {
      for (let index = 0; index < 50; index++) window.dispatchEvent(new CustomEvent('test-chat-event', {
        detail: { method: 'remote-chat/history-changed', params: { threadId: 'chat-0', reason: 'thread/resumed' } },
      }));
    });
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('.chat-thread-list')).toHaveAttribute('aria-busy', 'true');
    await expect(refresh.locator('.chat-spinner')).toHaveCount(0);
    await expect(page.locator('.chat-thread')).toHaveCount(5);
    finish();
    await expect(refresh).toBeEnabled();
    let finishManual = () => {};
    const manual = new Promise<void>(resolve => { finishManual = resolve; });
    await page.route('**/thread-page?*', async route => {
      await manual;
      await route.fulfill({ json: { data: threads(0, 6, true), nextCursor: null } });
    });
    await refresh.click();
    await expect(refresh.locator('.chat-spinner')).toHaveCount(1);
    await expect(page.locator('.chat-thread')).toHaveCount(5);
    finishManual();
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator('.chat-spinner')).toHaveCount(0);
  });
