import { expect, test, type Page } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import { openLoungeAction } from './lounge-mobile-actions';

declare global { interface Window { historyFixture: { reads: number; fail: boolean } } }
const panel = (page: Page) => page.locator('.lounge-desktop-history');
const holder = (page: Page) => panel(page).locator('.rc-virtual-list-holder');
const count = 190;
const text = (index: number) => `记录 ${String(index).padStart(3, '0')} · ${index % 2
  ? '周末你没出去玩' : '这条比较长的消息用于检查自然换行，继续聊聊今天的设计和开发进展。'}`;

async function instrumentHistory(page: Page) {
  await page.addInitScript(() => {
    window.historyFixture = { reads: 0, fail: false };
    const original = IDBIndex.prototype.openCursor;
    IDBIndex.prototype.openCursor = function (...args) {
      if (this.name === 'timeline') {
        window.historyFixture.reads++;
        if (window.historyFixture.fail) throw new Error('History unavailable in test');
      }
      return original.apply(this, args);
    };
  });
}

async function scroll(page: Page, end: 'older' | 'newer') {
  await holder(page).evaluate((node, direction) => {
    node.scrollTop = direction === 'older' ? node.scrollHeight : 0;
    node.dispatchEvent(new Event('scroll'));
  }, end);
  await page.waitForTimeout(250);
  await expect(panel(page).locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
}

async function checkPrefetch(page: Page) {
  const delta = await panel(page).locator('[aria-busy]').evaluate(viewport => new Promise<number>((resolve, reject) => {
    let anchor: { key: string; top: number } | undefined;
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Preload did not finish')); }, 10_000);
    const observer = new MutationObserver(() => {
      if (viewport.getAttribute('aria-busy') === 'true') {
        const top = viewport.getBoundingClientRect().top;
        const first = [...viewport.querySelectorAll<HTMLElement>('[data-history-key]')]
          .find(row => row.getBoundingClientRect().bottom > top + 1);
        if (first) anchor = { key: first.dataset.historyKey!, top: first.querySelector('article')!.getBoundingClientRect().top };
      } else if (anchor) {
        observer.disconnect(); clearTimeout(timer);
        setTimeout(() => {
          const same = [...viewport.querySelectorAll<HTMLElement>('[data-history-key]')]
            .find(row => row.dataset.historyKey === anchor!.key);
          resolve(same ? same.querySelector('article')!.getBoundingClientRect().top - anchor!.top : Infinity);
        }, 200);
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ['aria-busy'] });
    const list = viewport.querySelector('.rc-virtual-list-holder')!;
    list.scrollTop = list.scrollHeight - list.clientHeight - 400;
    list.dispatchEvent(new Event('scroll'));
  }));
  expect(Math.abs(delta), 'Preloading must preserve the visible message position').toBeLessThan(4);
}

for (const mode of ['local', 'remote', 'web']) for (const width of [1440, 880]) {
  test(`${mode} ${width}: desktop history preloads, scrolls both ways, searches and preserves actions`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await instrumentHistory(page);
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    for (let index = 0; index < count; index++) relay.frame({ type: 'message', id: `history-${index}`,
      text: text(index), images: index === 7 ? [pixel] : [],
      sender: { id: 'bob', account: 'yangpeng', nickname: '杨鹏', moderator: index % 3 === 0, avatar: pixel },
      sentAt: new Date(Date.UTC(2026, 10, 2, 8, index)).toISOString() });
    const before = await page.evaluate(() => window.historyFixture.reads);
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.historyFixture.reads), { timeout: 30_000 }).toBeGreaterThan(before);
    await openLoungeAction(page, '历史记录');
    await expect(panel(page).getByText(text(count - 1), { exact: true })).toBeInViewport();
    await expect(panel(page).getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
    expect(await panel(page).locator('.lounge-history-message').count()).toBeLessThan(25);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        if (window.loungeFixture) window.loungeFixture.setTheme(value as 'light' | 'dark');
        else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: value }));
      }, theme);
      await page.screenshot({ path: `../../.codex-tmp/lounge-history-redesign/${mode}-${width}-${theme}-latest.png`,
        animations: 'disabled' });
    }
    await checkPrefetch(page);
    await page.evaluate(() => { window.historyFixture.fail = true; });
    await holder(page).evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
    await expect(panel(page).getByRole('alert')).toBeVisible();
    expect(await panel(page).locator('.lounge-history-message').count()).toBeGreaterThan(0);
    await page.evaluate(() => { window.historyFixture.fail = false; });
    await panel(page).getByRole('button', { name: '重试', exact: true }).click();
    for (let attempt = 0; attempt < 9; attempt++) {
      await scroll(page, 'older');
      if (await panel(page).getByText(text(0), { exact: true }).isVisible()) break;
    }
    await expect(panel(page).getByText(text(0), { exact: true })).toBeInViewport();
    for (let attempt = 0; attempt < 9; attempt++) {
      await scroll(page, 'newer');
      if (await panel(page).getByText(text(count - 1), { exact: true }).isVisible()) break;
    }
    await expect(panel(page).getByText(text(count - 1), { exact: true })).toBeInViewport();
    await page.context().setOffline(true);
    const search = panel(page).getByRole('textbox', { name: '搜索消息或账户' });
    await search.fill('记录 007'); await expect(panel(page).locator('.lounge-history-message')).toHaveCount(1);
    await expect(panel(page).locator('.lounge-image img')).toBeVisible();
    const bubble = panel(page).locator('.lounge-bubble');
    for (const touch of [false, true]) {
      if (touch) {
        await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0 });
      } else await bubble.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '引用回复', exact: true })).toBeVisible();
      if (touch) await bubble.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0 });
      await panel(page).locator('.ant-drawer-title').click();
    }
    await page.screenshot({ path: `../../.codex-tmp/lounge-history-redesign/${mode}-${width}-dark-search.png`,
      animations: 'disabled' });
    await search.fill('没有这样的消息'); await expect(panel(page)).toContainText('没有找到匹配的记录');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: empty and short history accepts newly arriving records without a scroll gesture`, async ({ page }) => {
    const mobile = mode === 'mobile';
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, mobile || mode === 'web');
    await page.goto(mobile || mode === 'web' ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await openLoungeAction(page, '历史记录');
    const history = page.locator(mobile ? '.lounge-history-screen' : '.lounge-desktop-history');
    await expect(history).toContainText('暂时没有聊天记录');
    relay.push('从空历史收到的第一条消息');
    await expect(history.getByText('从空历史收到的第一条消息', { exact: true })).toBeInViewport();
    relay.push('短历史中刚刚收到的新消息');
    await expect(history.getByText('短历史中刚刚收到的新消息', { exact: true })).toBeInViewport();
    await expect(history.locator('.lounge-history-message')).toHaveCount(2);
  });
}
