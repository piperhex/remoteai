import { expect, type BrowserContext, type Page } from '@playwright/test';
import './chat-harness-types';

interface Options { context: BrowserContext; page: Page; endpoint: string; blocked: boolean }

async function openHistoryHost({ context, endpoint, blocked }: Options) {
  const host = await context.newPage();
  await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&title=Remote%20history`
    + `&blocked=${blocked}&socket=${encodeURIComponent(endpoint)}`);
  await expect(host.locator('#status')).toHaveText('registered');
  await host.evaluate(() => {
    window.chatTest.demoState().threads[0].turns = [{ id: 'history', status: 'completed', items: [
      ...Array.from({ length: 24 }, (_, index) => ({ id: `older-${index}`, type: 'agentMessage', phase: 'final_answer',
        text: `更早记录 ${index}\n\n验证 PC 远程聊天加载后的阅读位置。` })),
      ...Array.from({ length: 40 }, (_, index) => ({ id: `command-${index}`, type: 'commandExecution',
        status: 'completed', command: 'echo history' })),
      { id: 'latest', type: 'agentMessage', text: 'PC 远程聊天历史测试。' },
    ] }];
    window.chatTest.setHistoryDelay(800);
  });
  return host;
}

export async function checkRemoteHistory(options: Options) {
  const { page, endpoint, blocked } = options;
  const host = await openHistoryHost(options);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await page.bringToFront();
  await page.getByRole('button', { name: /^切换主机：/ }).click();
  await page.getByRole('menuitemradio', { name: /Office PC/ }).click();
  await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
    .toContainText(blocked ? 'Relay' : 'P2P', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Remote history', exact: true }).click();
  const viewport = page.getByLabel('聊天记录');
  await expect(page.locator('[data-message-id="latest"]')).toBeInViewport();
  // Folded process groups leave room for older visible messages in the first page.
  const initialCount = await page.locator('[data-message-id^="older-"]').count();
  expect(initialCount).toBeLessThan(24);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.wheel(0, -10000);
  await expect(page.getByRole('button', { name: '加载中…', exact: true })).toBeDisabled();
  await expect.poll(() => page.locator('[data-message-id^="older-"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(initialCount);
  await expect(page.getByRole('button', { name: '加载更早的消息' })).toBeEnabled();
  expect(await host.evaluate(() => window.chatTest.demoState().operations
    .filter(operation => operation.operation === 'syncHistory').length)).toBeGreaterThan(1);
  await expect.poll(() => viewport.evaluate(node => node.scrollTop > node.clientHeight / 2)).toBe(true);
  await checkPrefetchAnchor(page);
  await expect(page.locator('[data-message-id^="older-"]')).toHaveCount(24);
  await expect(page.getByText(/已加载 \d+ 条历史记录/)).toHaveCount(0);
  await page.screenshot({ path: `../../.codex-tmp/remote-history-${blocked ? 'relay' : 'direct'}.png` });
  await checkLatestShortcut(page);
  expect(await host.evaluate(() => window.chatTest.demoState().streamErrors)).toEqual([]);
}

async function checkLatestShortcut(page: Page) {
  const viewport = page.getByLabel('聊天记录');
  const button = page.getByRole('button', { name: '回到底部', exact: true });
  for (const [extra, visible] of [[0, false], [1, true], [0, false], [1, true]] as const) {
    await viewport.evaluate((node, extra) => {
      const remaining = Math.floor(node.clientHeight / 2) + extra;
      node.scrollTop = node.scrollHeight - node.clientHeight - remaining;
      node.dispatchEvent(new Event('scroll'));
    }, extra);
    if (visible) await expect(button).toBeVisible();
    else await expect(button).toHaveCount(0);
  }
  await button.click();
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(2);
  await expect(button).toHaveCount(0);
}

async function checkPrefetchAnchor(page: Page) {
  const viewport = page.getByLabel('聊天记录');
  await viewport.evaluate(node => { node.scrollTop = Math.floor(node.clientHeight / 2); });
  await expect(page.getByRole('button', { name: '加载中…', exact: true })).toBeDisabled();
  const anchor = await viewport.evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const entry = [...node.querySelectorAll('[data-message-id]')]
      .find(item => item.getBoundingClientRect().bottom > top)!;
    return { id: entry.getAttribute('data-message-id'), top: entry.getBoundingClientRect().top };
  });
  await expect(page.getByRole('button', { name: '加载中…', exact: true })).toHaveCount(0);
  await expect.poll(async () => Math.abs((await page.locator(`[data-message-id="${anchor.id}"]`)
    .boundingBox())!.y - anchor.top)).toBeLessThan(3);
}
