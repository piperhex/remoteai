import { expect, test } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import type {} from './lounge-harness';

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: pinned account entry opens settings and follows the current identity`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await page.getByRole('button', { name: '在线交流', exact: true }).click();
    for (let index = 0; index < 24; index++) {
      relay.private('hello', { id: `contact-${index}`, account: `contact-${index}@example.test` });
    }
    const trigger = page.getByRole('button', { name: '我的账号', exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.locator('.lounge-heading .lounge-avatar')).toHaveCount(0);
    await expect(page.locator('.lounge-heading').getByRole('button', { name: '个人资料' })).toHaveCount(0);
    const position = await trigger.boundingBox();
    const list = page.locator('.lounge-sidebar .lounge-people-list');
    await expect(list.getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(24);
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await trigger.boundingBox()).toEqual(position);
    await expect(list.getByRole('button').last()).toBeInViewport();
    relay.avatar(pixel);
    await expect(trigger.locator('img')).toHaveAttribute('src', pixel);
    relay.names.update('nickname', 'alice', '新的昵称');
    await expect(trigger).toContainText('新的昵称');
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留草稿');
    await trigger.click();
    const settings = page.getByRole('menuitem', { name: '设置', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings).toBeInViewport();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.lounge-my-account-menu:visible')).toHaveCSS('opacity', '1');
    await expect(page.locator('.lounge-my-account-menu:visible')).not.toHaveClass(/-(appear|enter)(-|\s|$)/);
    const menuBox = await page.getByRole('menu').boundingBox();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(position!.y);
    expect(menuBox!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: `../../.codex-tmp/lounge-my-account-${mode}-light.png`, animations: 'disabled' });
    await page.locator('.lounge-heading h1').click();
    await expect(settings).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus(); await trigger.press('Enter');
    await expect(settings).toBeVisible();
    await settings.focus(); await settings.press('Enter');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(dialog.getByRole('textbox', { name: '昵称', exact: true })).toHaveValue('新的昵称');
    await expect(dialog.getByRole('button', { name: '修改头像', exact: true })).toBeVisible();
    await dialog.getByRole('textbox').press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留草稿');
    await page.evaluate(() => {
      if (window.loungeFixture) window.loungeFixture.setTheme('dark');
      else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: 'dark' }));
    });
    await trigger.click(); await expect(settings).toBeVisible();
    await expect(settings).toBeInViewport();
    await expect(page.locator('.lounge-my-account-menu:visible')).toHaveCSS('opacity', '1');
    await expect(page.locator('.lounge-my-account-menu:visible')).not.toHaveClass(/-(appear|enter)(-|\s|$)/);
    await page.screenshot({ path: `../../.codex-tmp/lounge-my-account-${mode}-dark.png`, animations: 'disabled' });
  });
}

test('narrow desktop: account settings close the people drawer; copy switches offline', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  const relay = await setupLounge(page);
  await page.goto('/e2e/lounge-harness.html?mode=remote'); await relay.ready();
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  await page.getByRole('button', { name: '用户列表', exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  const trigger = drawer.getByRole('button', { name: '我的账号', exact: true });
  await expect(trigger).toBeInViewport(); await trigger.click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await expect(drawer).toBeHidden();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(dialog.getByRole('textbox', { name: '昵称', exact: true })).toBeVisible();
  await dialog.getByRole('textbox').press('Escape');
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().setOffline(true);
  for (const [language, account, settings] of [
    ['en', 'My account', 'Settings'], ['ja', 'マイアカウント', '設定'],
    ['ru', 'Мой аккаунт', 'Настройки'], ['zh', '我的账号', '设置'],
  ] as const) {
    await page.evaluate(value => window.loungeFixture.setLanguage(value), language);
    await page.getByRole('button', { name: account, exact: true }).click();
    await page.getByRole('menuitem', { name: settings, exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: settings, exact: true });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole('textbox').press('Escape');
    await expect(settingsDialog).toBeHidden();
  }
});
