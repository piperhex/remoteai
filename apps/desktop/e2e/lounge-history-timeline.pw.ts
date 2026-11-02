import { expect, test, type Page } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import { openLoungeAction } from './lounge-mobile-actions';

const count = 320;
const messageText = (index: number) => `记录 ${String(index).padStart(3, '0')} · ${index % 2
  ? '好的，稍后一起看看。' : '今天的讨论很有收获，明天继续交流。'}`;
const screen = (page: Page) => page.locator('.lounge-history-screen');
const holder = (page: Page) => screen(page).locator('.rc-virtual-list-holder');

async function scrollEnd(page: Page, direction: 'older' | 'newer') {
  await holder(page).evaluate((node, value) => {
    node.scrollTop = value === 'older' ? 0 : node.scrollHeight;
    node.dispatchEvent(new Event('scroll'));
  }, direction);
  await page.waitForTimeout(180);
  await expect(screen(page).locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
}

async function checkPreloadAnchor(page: Page) {
  const delta = await screen(page).locator('[aria-busy]').evaluate(viewport => new Promise<number>((resolve, reject) => {
    let saved: { key: string; top: number } | undefined;
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Preload did not finish')); }, 10_000);
    const observer = new MutationObserver(() => {
      if (viewport.getAttribute('aria-busy') === 'true') {
        const top = viewport.getBoundingClientRect().top;
        const first = [...viewport.querySelectorAll<HTMLElement>('[data-history-key]')]
          .find(row => row.getBoundingClientRect().bottom > top + 1);
        if (first) saved = { key: first.dataset.historyKey!, top: first.querySelector('article')!.getBoundingClientRect().top };
      } else if (saved) {
        observer.disconnect(); clearTimeout(timer);
        setTimeout(() => {
          const same = [...viewport.querySelectorAll<HTMLElement>('[data-history-key]')]
            .find(row => row.dataset.historyKey === saved!.key);
          resolve(same ? same.querySelector('article')!.getBoundingClientRect().top - saved!.top : Infinity);
        }, 200);
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ['aria-busy'] });
    const scroll = viewport.querySelector('.rc-virtual-list-holder')!;
    scroll.scrollTop = 350; scroll.dispatchEvent(new Event('scroll'));
  }));
  expect(Math.abs(delta), 'Preloading must preserve the visible message position').toBeLessThan(4);
}

for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
  test(`mobile history ${width} ${theme}: bidirectional virtualization, search and actions`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    await page.getByRole('button', { name: '群聊', exact: true }).click();
    for (let index = 0; index < count; index++) relay.frame({ type: 'message', id: `timeline-${index}`,
      text: messageText(index), images: index === 7 ? [pixel] : [],
      sender: { id: index % 2 ? 'alice' : 'bob', account: `${index % 2 ? 'alice' : 'bob'}@example.test` },
      sentAt: new Date(Date.UTC(2026, 9, 20, 0, index * 30)).toISOString() });
    await openLoungeAction(page, '历史记录');
    const search = screen(page).getByRole('textbox', { name: '搜索消息或账户' });
    // Searching once waits for the durable archive queue, then reopening exercises the unfiltered initial page.
    await search.fill('记录 319'); await expect(screen(page)).toContainText(messageText(319), { timeout: 30_000 });
    await search.clear();
    await expect(screen(page).getByText(messageText(319), { exact: true })).toBeInViewport();
    await expect(screen(page).locator('h1')).toHaveCSS('color', theme === 'dark' ? 'rgb(237, 242, 244)' : 'rgb(32, 43, 51)');
    await page.screenshot({ path: `../../.codex-tmp/lounge-history/web-${width}-${theme}-latest.png` });
    expect(await screen(page).locator('.lounge-history-message').count()).toBeLessThan(25);
    await checkPreloadAnchor(page);
    // Every loaded page is chronological and exclusive; traverse beyond the bounded 150-record cache.
    for (let attempt = 0; attempt < 12; attempt++) {
      await scrollEnd(page, 'older');
      if (await screen(page).getByText(messageText(0), { exact: true }).isVisible()) break;
    }
    await expect(screen(page).getByText(messageText(0), { exact: true })).toBeInViewport();
    await expect(screen(page).locator('.lounge-history-date').first()).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-history/web-${width}-${theme}-oldest.png` });
    for (let attempt = 0; attempt < 12; attempt++) {
      await scrollEnd(page, 'newer');
      if (await screen(page).getByText(messageText(319), { exact: true }).isVisible()) break;
    }
    await expect(screen(page).getByText(messageText(319), { exact: true })).toBeInViewport();
    expect(await screen(page).locator('.lounge-history-message').count()).toBeLessThan(25);
    await page.context().setOffline(true);
    await search.fill('记录 007'); await expect(screen(page).locator('.lounge-history-message')).toHaveCount(1);
    await expect(screen(page)).toContainText(messageText(7));
    await page.screenshot({ path: `../../.codex-tmp/lounge-history/web-${width}-${theme}-search.png` });
    await screen(page).locator('.lounge-bubble').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '引用回复', exact: true })).toBeVisible();
    await page.locator('.lounge-mobile-menu-backdrop').click({ position: { x: 2, y: 2 } });
    const bubble = screen(page).locator('.lounge-bubble');
    const bounds = (await bubble.boundingBox())!;
    const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0,
      clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 };
    await bubble.dispatchEvent('pointerdown', touch);
    await expect(page.getByRole('menuitem')).toHaveText(['复制', '引用回复']);
    await bubble.dispatchEvent('pointerup', touch);
    await page.locator('.lounge-mobile-menu-backdrop').click({ position: { x: 2, y: 2 } });
    await screen(page).getByRole('button', { name: '返回聊天', exact: true }).click();
    await expect(screen(page)).toBeHidden();
  });
}

test('mobile private history preserves conversation scope and updates read receipts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const relay = await setupLounge(page, true);
  await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
  relay.push('只在群聊显示'); relay.private('你好，下午一起讨论一下设计方案？');
  await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('好的，我们下午见。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => relay.sent.length).toBe(1);
  await openLoungeAction(page, '历史记录');
  await expect(screen(page).getByRole('img', { name: '对方已收到', exact: true })).toBeVisible();
  relay.receipt(relay.sent[0].id, 'read');
  await expect(screen(page).getByRole('img', { name: '对方已阅读', exact: true })).toBeVisible();
  await expect(screen(page)).not.toContainText('只在群聊显示');
  await page.screenshot({ path: '../../.codex-tmp/lounge-history/web-390-light-private.png', animations: 'disabled' });
});
