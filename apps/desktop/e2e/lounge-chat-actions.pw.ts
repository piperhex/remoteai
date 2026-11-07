import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';

async function longPress(row: Locator) {
  const bounds = (await row.boundingBox())!;
  const pointer = { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: bounds.x + 20, clientY: bounds.y + bounds.height / 2 };
  await row.dispatchEvent('pointerdown', pointer);
  await expect(row.page().getByRole('menu')).toBeVisible();
  await row.dispatchEvent('pointerup', pointer);
}

async function verifyLongAccount({ page, sheet, relay, variant }: {
  page: Page; sheet: Locator; relay: Awaited<ReturnType<typeof setupLounge>>; variant: string;
}) {
  const account = '中文联系人.very.long.email.address';
  relay.private('长名称', { id: 'long', account });
  const row = page.getByRole('button', { name: `与 ${account} 私聊`, exact: true });
  await expect(row).toBeVisible(); await longPress(row);
  await expect(sheet.getByRole('heading', { name: account })).toBeVisible();
  await expect(sheet.getByRole('menuitem', { name: '删除', exact: true })).toBeInViewport();
  await page.screenshot({ path: `../../.codex-tmp/lounge-actions-long-${variant}.png`, animations: 'disabled' });
  expect(await sheet.locator('.ant-drawer-content').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await sheet.locator('.ant-drawer-close').click();
}

for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
  test(`mobile chat action sheet ${width} ${theme}: gestures, actions and dismissal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click(); relay.private('抽屉操作测试');
    const row = page.getByRole('button', { name: '与 bob 私聊', exact: true });
    await expect(row).toBeVisible(); await row.click({ button: 'right' });
    const sheet = page.locator('.lounge-chat-actions-sheet');
    await expect(sheet.getByRole('heading', { name: 'bob' })).toBeVisible();
    const actions = ['发起私聊', '置顶', '消息免打扰', '屏蔽此人', '删除'];
    await expect(sheet.getByRole('menuitem')).toHaveText(actions);
    await expect(sheet.getByRole('menuitem', { name: '删除', exact: true })).toBeInViewport();
    await page.screenshot({ path: `../../.codex-tmp/lounge-actions-${width}-${theme}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await expect(sheet).toBeHidden();
    await longPress(row); await expect(sheet.getByRole('menuitem')).toHaveText(actions);
    await sheet.getByRole('menuitem', { name: '置顶', exact: true }).click();
    await expect(sheet).toBeHidden(); await expect(page.getByRole('img', { name: '已置顶' })).toBeVisible();
    await longPress(row); await sheet.getByRole('menuitem', { name: '取消置顶' }).click();
    await row.click({ button: 'right' }); await sheet.getByRole('menuitem', { name: '屏蔽此人' }).click();
    await expect(sheet).toBeHidden(); await page.getByRole('button', { name: /^取\s*消$/ }).click();
    await row.click({ button: 'right' }); await sheet.getByRole('menuitem', { name: '删除', exact: true }).click();
    await expect(page.getByText('删除这段私聊？', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^取\s*消$/ }).click();
    await row.click({ button: 'right' }); await sheet.getByRole('menuitem', { name: '发起私聊' }).click();
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
    await longPress(row); await sheet.locator('.ant-drawer-mask').click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeHidden();
    await verifyLongAccount({ page, sheet, relay, variant: `${width}-${theme}` });
    relay.offline(); relay.close(); await longPress(row);
    await expect(sheet.getByRole('menuitem', { name: '删除', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    expect(await sheet.locator('.ant-drawer-content').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}
