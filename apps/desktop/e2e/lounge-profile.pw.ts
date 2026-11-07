import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';

const profileLabel = '查看 bob 的资料';
const privateLabel = '与 bob 私聊';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function enter(page: Page) {
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
}

async function swipeRight(page: Page, session: CDPSession) {
  await button(page, privateLabel).hover();
  const bounds = (await button(page, privateLabel).boundingBox())!;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: bounds.y + 20 }] });
  for (const x of [145, 170, 200, 220]) await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x, y: bounds.y + 20 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const row = page.locator('.lounge-swipe-row').filter({ has: button(page, privateLabel) });
  await expect(row.locator('.lounge-swipe-content')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 76, 0)');
  await page.waitForTimeout(450);
}

test('mobile profile: released languages remain available offline', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const relay = await setupLounge(page, false, true);
  await page.goto('/e2e/lounge-harness.html?mobile&dark'); await relay.ready();
  await button(page, '在线交流').click(); await button(page, '群聊').click(); relay.push('profile languages');
  await button(page, profileLabel).click(); await button(page, '发消息').hover();
  await page.context().setOffline(true);
  for (const [language, send, remove] of [
    ['en', 'Message', 'Delete'], ['ja', 'メッセージを送る', '削除'],
    ['ru', 'Написать', 'Удалить'], ['zh', '发消息', '删除'],
  ] as const) {
    await page.evaluate(value => window.loungeFixture.setLanguage(value), language);
    await expect(button(page, send)).toBeVisible(); await expect(button(page, remove)).toBeVisible();
    await expect(page.locator('.lounge-profile')).not.toContainText('client.lounge.');
    const bounds = (await button(page, send).boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
});

for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
  test(`mobile profile ${width} ${theme}: avatar, history and drafts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready(); await enter(page);
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await button(page, '群聊').click(); relay.push('profile source');
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('retained group draft');
    await button(page, profileLabel).click();
    const profile = page.locator('.lounge-profile');
    await expect(profile).toContainText('bob');
    await expect(profile).not.toContainText('在线');
    await expect(button(page, '发消息')).toBeVisible();
    await button(page, '发消息').hover();
    await page.screenshot({ path: `../../.codex-tmp/lounge-profile-${width}-${theme}.png` });
    await button(page, '返回').click(); await expect(input).toHaveValue('retained group draft');
    await button(page, '添加内容').click(); await button(page, '历史记录').click();
    await page.locator('.lounge-history-message').getByRole('button', { name: profileLabel }).click();
    await button(page, '返回').click();
    await expect(page.getByRole('textbox', { name: '搜索消息或账户' })).toBeVisible();
    await page.locator('.lounge-history-message').getByRole('button', { name: profileLabel }).click();
    await button(page, '发消息').click();
    await expect(page.getByRole('dialog', { name: '历史记录', exact: true })).toBeHidden();
    await expect(input).toHaveValue('');
    await expect(page.locator('.lounge-mobile-heading')).toContainText('bob');
  });
}

test('mobile deletion: swipe, both menu gestures, restart and fresh exchange', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const relay = await setupLounge(page, true, true);
  await page.goto('http://127.0.0.1:1486/web/'); await relay.ready(); await enter(page);
  relay.private('old private history');
  const row = page.locator('.lounge-swipe-row').filter({ has: button(page, privateLabel) });
  await expect(row).toBeVisible();
  await button(page, privateLabel).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeHidden();
  await button(page, privateLabel).hover();
  const bounds = (await button(page, privateLabel).boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart',
    touchPoints: [{ x: bounds.x + 20, y: bounds.y + 20 }] });
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  // Real touch events exercise pointer capture and the browser's pan-y behavior.
  await swipeRight(page, session);
  await page.screenshot({ path: '../../.codex-tmp/lounge-profile-swipe.png' });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(row).toContainText('old private history');
  await button(page, privateLabel).click();
  await page.locator('.lounge-heading .lounge-avatar').click(); await button(page, '删除').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('dialog').filter({ hasText: '你所有设备' })
    .getByRole('button', { name: '删除', exact: true }).click();
  await expect(button(page, privateLabel)).toHaveCount(0);
  await page.reload(); await relay.ready(); await enter(page);
  await expect(button(page, privateLabel)).toHaveCount(0);
  await button(page, '群聊').click(); relay.push('fresh profile source');
  await button(page, profileLabel).click(); await button(page, '发消息').click();
  await expect(page.locator('.lounge-message')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('new opening'); await button(page, '发送').click(); await expect(input).toHaveValue('');
  const sentCount = relay.sent.length;
  await input.fill('continue without resetting permissions'); await button(page, '发送').click();
  await expect(input).toHaveValue('');
  expect(relay.sent).toHaveLength(sentCount + 1);
  relay.private('fresh answer'); await expect(page.getByText('fresh answer', { exact: true })).toBeVisible();
  await input.fill('continue after reply');
  await button(page, '发送').click(); await expect(input).toHaveValue('');
  expect(relay.sent).toHaveLength(sentCount + 2);
  await button(page, '返回聊天列表').click();
  await expect(row).toBeVisible();
  // A successful swipe deletion is independently exercised after the profile deletion.
  await swipeRight(page, session);
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(button(page, privateLabel)).toHaveCount(0);
});
