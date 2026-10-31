import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupLounge, pixel } from './lounge-support';
const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';

async function hold(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.click({ trial: true });
  const bounds = (await target.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  ] });
  await page.waitForTimeout(750);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

async function verifyCompactOwnMenu(page: Page, width: number) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('🥺');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const bubble = page.locator('.lounge-message.is-own .lounge-bubble').last();
  await hold(page, bubble);
  const menu = page.getByRole('menu', { name: '消息操作' });
  await expect(menu.getByRole('menuitem')).toHaveText(['复制', '引用回复']);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.width).toBeLessThan(200);
  expect(bounds.height).toBeLessThan(90);
  await page.screenshot({ path: `../../.codex-tmp/lounge-menu-compact/web-own-menu-${width}.png` });
  await page.keyboard.press('Escape');
  await bubble.click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['复制', '引用回复']);
  await menu.getByRole('menuitem', { name: '复制', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe('🥺');
}

for (const width of [320, 390]) {
  test(`mobile gestures ${width}: avatar mentions and anchored message actions`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => sessionStorage.setItem('copied-text', text),
      write: async (items: ClipboardItem[]) => {
        const image = await items[0].getType('image/png');
        sessionStorage.setItem('copied-image', `${image.type}:${image.size}`);
      },
    } }));
    await page.goto(webURL); await relay.ready();
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    await page.getByRole('button', { name: '群聊', exact: true }).click();
    relay.push('长按消息操作');
    const row = page.locator('.lounge-message').filter({ hasText: '长按消息操作' });
    const avatar = row.locator('.lounge-avatar');
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('前后');
    await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(1, 1));
    await hold(page, avatar);
    await expect(input).toHaveValue('前@bob 后');
    await expect(input).toBeFocused();
    await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toBeHidden();
    await expect(page.getByRole('menu')).toBeHidden();
    await avatar.click();
    await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toBeHidden();
    const bubble = row.locator('.lounge-bubble');
    await hold(page, bubble);
    const menu = page.getByRole('menu', { name: '消息操作' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['复制', '引用回复', '发起私聊', '屏蔽此人']);
    expect(await menu.locator('svg').count()).toBe(4);
    await expect(menu).toHaveCSS('background-color', 'rgb(91, 91, 91)');
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `../../.codex-tmp/lounge-mobile-menu-${width}.png` });
    await menu.getByRole('menuitem', { name: '复制', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe('长按消息操作');
    await bubble.click({ button: 'right' });
    await expect(menu.getByRole('menuitem')).toHaveText(['复制', '引用回复', '发起私聊', '屏蔽此人']);
    await menu.getByRole('menuitem', { name: '引用回复' }).click();
    await expect(page.locator('.lounge-reply-draft')).toContainText('长按消息操作');
    await expect(input).toHaveValue('前@bob 后');
    await page.getByRole('button', { name: '取消引用' }).click();
    await page.getByRole('button', { name: '添加内容', exact: true }).click();
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await hold(page, page.locator('.lounge-history-message .lounge-avatar'));
    await expect(page.getByRole('textbox', { name: '搜索消息或账户' })).toBeHidden();
    await expect(input).toHaveValue('前@bob @bob 后');
    relay.push('', [pixel]);
    await hold(page, page.locator('.lounge-bubble.image-only').last());
    await expect(page.locator('.lounge-preview')).toBeHidden();
    await menu.getByRole('menuitem', { name: '复制', exact: true }).click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('copied-image'))).toMatch(/^image\/png:[1-9]/);
    await page.setViewportSize({ width, height: 450 });
    await hold(page, bubble);
    expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(450);
    await page.screenshot({ path: `../../.codex-tmp/lounge-mobile-menu-keyboard-${width}.png` });
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
    await bubble.dispatchEvent('pointerdown', { pointerId: 4, pointerType: 'touch', isPrimary: true,
      button: 0, clientX: 100, clientY: 200 });
    await bubble.dispatchEvent('pointermove', { pointerId: 4, clientX: 100, clientY: 250 });
    await page.waitForTimeout(650); await expect(menu).toBeHidden();
    await bubble.dispatchEvent('pointercancel', { pointerId: 4 });
    expect(relay.sent).toHaveLength(0);
    await page.setViewportSize({ width, height: 844 });
    await verifyCompactOwnMenu(page, width);
  });
}
