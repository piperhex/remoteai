import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend } from './cli-gui-support';
import type { createCliGuiFixture } from './cli-gui-fixture';

const evidence = resolve('../../.codex-tmp/cli-mobile-swipe-evidence');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  actionTimeout: 15_000, screenshot: 'only-on-failure' });

async function swipe(page: Page, right: boolean) {
  const session = await page.context().newCDPSession(page);
  const start = right ? 90 : 290;
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y: 330 }] });
    for (const distance of [30, 60, 100, 170]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: start + (right ? distance : -distance), y: 330 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

async function navigate(page: Page, label: string) {
  await swipe(page, true);
  const drawer = page.locator('.chat-drawer .ant-drawer-content');
  await expect(drawer).toBeVisible();
  await expect.poll(async () => Math.abs((await drawer.boundingBox())?.x ?? Infinity)).toBeLessThan(1);
  await page.screenshot({ path: resolve(evidence, `${label}-right-drawer.png`) });
  await swipe(page, false);
  await expect(drawer).toHaveCount(0);
  await swipe(page, false);
  const back = page.getByRole('button', { name: 'Return to chat', exact: true });
  await expect(back).toBeVisible();
  await expect.poll(async () => Math.abs((await back.boundingBox())?.x ?? Infinity)).toBeLessThan(1);
  await page.screenshot({ path: resolve(evidence, `${label}-left-accounts.png`) });
  await back.click();
  await expect(page.locator('.chat-page')).toBeVisible();
}

for (const engine of ['claude', 'gemini'] as const) {
  for (const dark of [false, true]) {
    test(`${engine} mobile ${dark ? 'dark' : 'light'} swipes, clearing and streamed history`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await localBackend(page);
      await page.goto(`/e2e/cli-gui-harness.html?mode=web&swipe${dark ? '&dark' : ''}`);
      const label = `web-mobile-${dark ? 'dark' : 'light'}-${engine}`;
      await page.getByRole('button', { name: /聊天设置/ }).click();
      await page.getByRole('button', { name: '选择 CLI', exact: true }).click();
      await page.getByRole('radio', { name: engine === 'claude' ? 'Claude GUI' : 'Gemini GUI', exact: true }).click();
      const input = page.locator('.cli-gui-pane textarea');
      await expect(input).toBeVisible();
      await navigate(page, `${label}-empty`);
      await input.fill('检查项目');
      await page.locator('.cli-gui-pane').getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(input).toHaveValue('');
      await expect(page.getByText('检查项目', { exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-sent-cleared.png`) });
      await navigate(page, `${label}-conversation`);
      await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
      await page.getByRole('button', { name: engine === 'claude' ? '检查项目结构' : '整理测试计划', exact: true }).click();
      const samples = await page.evaluate(async engine => {
        const fixture = (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture;
        const seen: string[] = [];
        const observer = new MutationObserver(() => {
          const text = document.querySelector('.cli-gui-pane .chat-message-region')?.textContent ?? '';
          const match = text.match(/Stream step \d+/)?.[0];
          if (match && seen.at(-1) !== match) seen.push(match);
        });
        observer.observe(document.querySelector('.cli-gui-pane')!, { childList: true, characterData: true, subtree: true });
        for (let index = 1; index <= 8; index++) {
          fixture.setHistory(engine, [{ id: 'user', first: 1, last: 1, role: 'user', text: 'Stream test' },
            { id: 'reply', first: 2, last: index + 2, role: 'assistant', text: `Stream step ${index}` }],
          index === 8 ? 'idle' : 'running');
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        observer.disconnect();
        return seen;
      }, engine);
      expect(samples).toHaveLength(8);
      await expect(page.getByText('Stream step 8', { exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-stream-complete.png`) });
    });
  }
}
