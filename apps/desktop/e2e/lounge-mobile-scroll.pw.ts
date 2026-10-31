import { expect, test, type Locator } from '@playwright/test';
import { setupLounge } from './lounge-support';

for (const width of [320, 390]) {
  test(`mobile private manual scroll survives updates near the bottom at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    for (let index = 0; index < 30; index++) relay.private(`私聊记录 ${index}`);
    await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    const list = page.locator('.lounge-conversation');
    await expect(list.locator('.lounge-message')).toHaveCount(30);
    await leaveBelow(list, 20);
    const position = await list.evaluate(node => node.scrollTop);
    relay.private('滑动后收到的新消息');
    await expect(page.getByText('滑动后收到的新消息', { exact: true })).toBeVisible();
    expect(await list.evaluate(node => node.scrollTop)).toBe(position);
    await page.screenshot({ path: info.outputPath(`mobile-web-private-reading-${width}.png`) });
    await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
    await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    expect(await list.evaluate(node => node.scrollTop)).toBe(position);
    await leaveBelow(list, 0);
    relay.private('回到底部后继续跟随');
    await expect(list.locator('.lounge-message')).toHaveCount(32);
    await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(1);
  });

  test(`mobile private messages remain still after read receipts at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    relay.private('你好');
    await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    for (const text of ['怎么回事', '给我发个图片吧', '你好呀', '你给谁发消息']) {
      await page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
      await page.getByRole('button', { name: '发送', exact: true }).click();
    }
    await expect.poll(() => relay.sent.length).toBe(4);
    for (const message of relay.sent) relay.receipt(message.id, 'read');
    await expect(page.getByRole('img', { name: '对方已阅读', exact: true })).toHaveCount(4);
    const last = page.getByText('你给谁发消息', { exact: true });
    const bounds = await last.boundingBox();
    for (let sample = 0; sample < 10; sample++) {
      await page.waitForTimeout(150);
      expect(await last.boundingBox()).toEqual(bounds);
    }
    await page.screenshot({ path: info.outputPath(`mobile-web-private-idle-${width}.png`) });
    await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
    await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    expect(await last.boundingBox()).toEqual(bounds);
  });
}

async function leaveBelow(list: Locator, distance: number) {
  await list.evaluate((node, offset) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - offset;
    node.dispatchEvent(new Event('scroll'));
  }, distance);
  await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeCloseTo(distance, 0);
}

for (const [width, direct] of [[320, false], [390, false], [320, true], [390, true]] as const) {
  test(`mobile ${direct ? 'private' : 'group'} latest shortcut requires a full page at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    const receive = direct ? relay.private : relay.push;
    for (let index = 0; index < 40; index++) receive(`第 ${index + 1} 条中文消息，检查滚动和返回最新消息。`);
    const chat = direct ? '与 bob 私聊' : '群聊';
    await page.getByRole('button', { name: chat, exact: true }).click();
    const list = page.locator('.lounge-conversation');
    const latest = page.getByRole('button', { name: '回到最新消息', exact: true });
    await expect(list.locator('.lounge-message')).toHaveCount(40);
    await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(1);
    const height = await list.evaluate(node => node.clientHeight);
    for (const distance of [60, Math.floor(height / 2), height - 1]) {
      await leaveBelow(list, distance);
      await expect(latest).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath('less-than-one-page.png') });
    await leaveBelow(list, height);
    await expect(latest).toBeVisible();
    await expect(latest).toHaveText('');
    await expect(page.locator('.lounge-retention')).toHaveCount(0);
    expect(await list.evaluate(node => node.clientHeight)).toBe(height);
    await page.screenshot({ path: info.outputPath('one-page-below.png') });
    await leaveBelow(list, height - 1);
    await expect(latest).toHaveCount(0);
    await leaveBelow(list, height + 20);
    const position = await list.evaluate(node => node.scrollTop);
    await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
    await page.getByRole('button', { name: chat, exact: true }).click();
    await expect(latest).toBeVisible();
    expect(await list.evaluate(node => node.scrollTop)).toBe(position);
    await latest.click();
    await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(1);
    await expect(latest).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('back-at-latest.png') });
  });
}

test('mobile latest shortcut remeasures incoming content and keyboard-sized viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const relay = await setupLounge(page, true);
  await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
  await page.getByRole('button', { name: '群聊', exact: true }).click();
  for (let index = 0; index < 30; index++) relay.push(`message-${index}`);
  const list = page.locator('.lounge-conversation');
  await expect(list.locator('.lounge-message')).toHaveCount(30);
  const latest = page.getByRole('button', { name: '回到最新消息', exact: true });
  const height = await list.evaluate(node => node.clientHeight);
  await leaveBelow(list, height - 50);
  const position = await list.evaluate(node => node.scrollTop);
  await expect(latest).toHaveCount(0);
  relay.push('新增消息后，下方内容达到一整页');
  await expect(latest).toBeVisible();
  expect(await list.evaluate(node => node.scrollTop)).toBe(position);
  await latest.click();
  await leaveBelow(list, Math.floor(height * 0.75));
  await expect(latest).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 450 });
  await expect(latest).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(latest).toHaveCount(0);
});
