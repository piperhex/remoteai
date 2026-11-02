import { expect, test, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';
import { openAccountSettings } from './lounge-account-actions';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function enter(page: Page, mobile: boolean) {
  if (!mobile) return button(page, '在线交流').click();
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
}
async function openContact(page: Page, mobile: boolean, name: string, touch = false) {
  const row = button(page, `与 ${name} 私聊`);
  if (mobile) {
    await row.click();
    await page.locator('.lounge-heading-account').click();
    return;
  }
  if (touch) {
    const pointer = { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0 };
    await row.dispatchEvent('pointerdown', pointer);
    await expect(page.getByRole('menu')).toBeVisible();
    await row.dispatchEvent('pointerup', pointer);
  } else await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '个人资料', exact: true }).click();
}
async function closeProfile(page: Page, mobile: boolean, saved = true) {
  if (!mobile) return page.locator('.ant-modal-close').click();
  await button(page, '返回').click();
  if (!saved) return;
  await expect(page.locator('.lounge-profile')).toBeHidden();
  const back = button(page, '返回聊天列表');
  if (await back.isVisible()) await back.click();
}

for (const mode of ['local', 'remote', 'web', 'mobile-320', 'mobile-390']) {
  test(`${mode}: nickname and private remark save, reset, remote sync and restored metadata`, async ({ page }) => {
    test.setTimeout(120_000);
    const mobile = mode.startsWith('mobile');
    if (mobile) await page.setViewportSize({ width: Number(mode.split('-')[1]), height: 844 });
    const relay = await setupLounge(page, mobile || mode === 'web');
    relay.names.nicknames.set('bob', '小明');
    await page.goto(mobile || mode === 'web' ? 'http://127.0.0.1:1486/web/'
      : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await enter(page, mobile);
    if (mobile) await button(page, '个人资料').click();
    else await openAccountSettings(page);
    const nickname = page.getByRole('textbox', { name: '昵称', exact: true });
    await expect(button(page, '保存')).toHaveCount(0);
    await nickname.fill('我的昵称'); await nickname.blur();
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    expect(relay.names.nicknames.get('alice')).toBe('我的昵称');
    await closeProfile(page, mobile);
    relay.private('names test'); await expect(button(page, '与 小明 私聊')).toBeVisible();
    await openContact(page, mobile, '小明');
    const remark = page.getByRole('textbox', { name: '备注', exact: true });
    await expect(nickname).toHaveCount(0);
    await remark.fill('工作伙伴'); relay.names.reject = true; await remark.blur();
    await expect(page.getByRole('alert')).toHaveText('备注保存失败，请稍后重试。');
    await expect(remark).toHaveValue('工作伙伴');
    await closeProfile(page, mobile, false);
    await expect(remark).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('备注保存失败，请稍后重试。');
    relay.names.reject = false; await button(page, '重试').click();
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    expect(relay.names.remarks.get('bob')).toBe('工作伙伴');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        if (window.loungeFixture) window.loungeFixture.setTheme(value as 'light' | 'dark');
        else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: value }));
      }, theme);
      await page.screenshot({ path: `../../.codex-tmp/lounge-names-${mode}-${theme}.png`, animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await closeProfile(page, mobile);
    await expect(button(page, '与 工作伙伴 私聊')).toBeVisible();
    // Clear all local records; metadata must come back from the server when the contact is seen again.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('remoteai-lounge-history-v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const stores = [...db.objectStoreNames];
        const transaction = db.transaction(stores, 'readwrite');
        for (const store of stores) transaction.objectStore(store).clear();
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    }));
    await page.reload(); await enter(page, mobile);
    await expect(button(page, '与 工作伙伴 私聊')).toHaveCount(0);
    relay.private('restored contact');
    await expect(button(page, '与 工作伙伴 私聊')).toBeVisible();
    await openContact(page, mobile, '工作伙伴', true);
    await expect(remark).toHaveValue('工作伙伴');
    relay.names.update('remark', 'bob', '另一设备的备注');
    await expect(remark).toHaveValue('另一设备的备注');
    await remark.fill(''); await remark.press('Tab');
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    await closeProfile(page, mobile);
    await expect(button(page, '与 小明 私聊')).toBeVisible();
    relay.names.update('nickname', 'bob', '');
    await expect(button(page, '与 bob 私聊')).toBeVisible();
    await page.reload(); await enter(page, mobile);
    await expect(button(page, '与 bob 私聊')).toBeVisible();
    if (mobile) await button(page, '个人资料').click();
    else await openAccountSettings(page);
    await expect(nickname).toHaveValue('我的昵称');
    await nickname.fill(''); await closeProfile(page, mobile);
    await expect.poll(() => relay.names.nicknames.get('alice')).toBe('');
  });
}
