import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupLounge, pixel } from './lounge-support';

const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
test.setTimeout(120_000);

async function openMenu(page: Page, target: Locator, touch: boolean) {
  await expect(page.getByRole('menu')).toBeHidden();
  if (!touch) await target.click({ button: 'right' });
  else {
    const bounds = (await target.boundingBox())!;
    const pointer = { pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 };
    await target.dispatchEvent('pointerdown', pointer);
    await expect(page.getByRole('menu')).toBeVisible();
    await target.dispatchEvent('pointerup', pointer);
  }
  await expect(page.getByRole('menu')).toBeVisible();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toHaveCSS('font-size', '16px');
  return items;
}

async function screenshotMenu(page: Page, name: string) {
  await page.getByRole('menuitem').first().hover();
  await expect(page.locator('.lounge-context-menu:visible')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: `../../.codex-tmp/${name}.png`, animations: 'disabled' });
}

async function clipboardFixture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { sessionStorage.setItem('copied-text', text); },
      write: async (items: ClipboardItem[]) => {
        const image = await items[0].getType('image/png');
        sessionStorage.setItem('copied-image', `${image.type}:${image.size}`);
      },
    } });
  });
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: larger message, avatar and people menus support right click and touch long press`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await clipboardFixture(page);
    await page.goto(mode === 'web' ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await page.getByRole('button', { name: '在线交流', exact: true }).click();
    relay.push('复制这条消息');
    const row = page.locator('.lounge-message').filter({ hasText: '复制这条消息' });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    for (const touch of [false, true]) {
      const menu = await openMenu(page, row.locator('.lounge-bubble'), touch);
      await expect(menu).toHaveText(['复制', '引用回复', '个人资料', '发起私聊', '屏蔽此人']);
      if (!touch) await screenshotMenu(page, `lounge-message-menu-${mode}`);
      await menu.first().click();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe('复制这条消息');
      await input.fill('你好，继续'); await input.focus();
      await input.evaluate((node: HTMLTextAreaElement) => {
        node.setSelectionRange(3, 3); node.dispatchEvent(new Event('select', { bubbles: true }));
      });
      const avatar = await openMenu(page, row.locator('.lounge-avatar'), touch);
      await expect(avatar).toHaveText(['@该用户', '个人资料', '远程协助']);
      if (!touch) await screenshotMenu(page, `lounge-avatar-menu-${mode}`);
      await avatar.first().click();
      await expect(input).toHaveValue('你好，@bob 继续'); await expect(input).toBeFocused();
      await expect(page.locator('.lounge-heading h1')).toHaveText('在线交流');
    }
    relay.private('联系人');
    const person = page.locator('.lounge-people-list .lounge-person').filter({ hasText: 'bob' });
    for (const touch of [false, true]) {
      const menu = await openMenu(page, person, touch);
      await expect(menu).toHaveText(['发起私聊', '个人资料', '置顶', '消息免打扰', '屏蔽此人']);
      await page.screenshot({ path: `../../.codex-tmp/lounge-people-menu-${mode}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
    relay.push('', [pixel]);
    await openMenu(page, page.locator('.lounge-bubble.image-only').last(), false);
    await page.getByRole('menuitem', { name: '复制', exact: true }).click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('copied-image'))).toMatch(/^image\/png:[1-9]/);
    expect(relay.sent).toEqual([]);
  });
}
