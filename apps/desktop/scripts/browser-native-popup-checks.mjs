import { expect as baseExpect } from '@playwright/test';
import { verifyOpeningRegion } from './browser-native-popup-animation.mjs';
const expect = baseExpect.configure({ timeout: 15_000 });

export async function assertLive({ main, child }) {
  await expect(main.locator('.native-browser-overlay-preview')).toHaveCount(0);
  expect(await child.evaluate(() => document.visibilityState)).toBe('visible');
  const frames = await child.evaluate(() => window.frameCount);
  await expect.poll(() => child.evaluate(() => window.frameCount)).toBeGreaterThan(frames + 10);
}

export async function verifySettings({ main, popup, child, capture, nativePid }) {
  const settings = main.getByRole('button', { name: '浏览器设置', exact: true });
  await verifyOpeningRegion({ popup, nativePid, open: () => settings.click() });
  await expect(popup.locator('.browser-bookmark-settings-popup')).toBeVisible();
  await assertLive({ main, child }); await capture('settings');
  await popup.getByRole('button', { name: '所有书签', exact: true }).hover();
  await expect(popup.locator('.browser-settings-submenu-popup')).toBeVisible();
  await assertLive({ main, child }); await capture('settings-submenu');
  await settings.click();
  await expect(popup.locator('.browser-bookmark-settings-popup')).toHaveCount(0);
  await settings.click();
  await popup.getByRole('button', { name: '历史记录', exact: true }).click();
  const history = popup.getByRole('dialog', { name: '历史记录', exact: true });
  await expect(history).toBeVisible();
  await history.getByRole('textbox').fill('实时');
  await expect(history.getByRole('textbox')).toHaveValue('实时');
  await assertLive({ main, child }); await capture('history');
  await history.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(history).toHaveCount(0);
}

export async function verifyBookmarks({ main, popup, child, capture }) {
  const bookmark = main.locator('.browser-bookmark-item').first();
  await main.getByRole('button', { name: '所有书签', exact: true }).click();
  await expect(popup.locator('.browser-bookmark-menu').first()).toBeVisible();
  await assertLive({ main, child }); await capture('all-bookmarks');
  await child.getByLabel('page-draft').click();
  await bookmark.click({ button: 'right' });
  await expect(popup.getByRole('menuitem', { name: '编辑书签', exact: true })).toBeVisible();
  await capture('bookmark-context');
  await popup.getByRole('menuitem', { name: '编辑书签', exact: true }).click();
  const editor = popup.getByRole('dialog', { name: '编辑书签', exact: true });
  await expect(editor).toBeVisible();
  const title = editor.locator('input').first();
  await title.fill('实时测试页面（已编辑）');
  await assertLive({ main, child }); await capture('bookmark-editor');
  await editor.getByRole('button', { name: '保 存', exact: true }).click();
  await expect(bookmark).toContainText('实时测试页面（已编辑）');
  const bounds = await bookmark.boundingBox();
  const touch = { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0,
    clientX: bounds.x + 10, clientY: bounds.y + 10 };
  await bookmark.dispatchEvent('pointerdown', touch);
  await expect(popup.getByRole('menuitem', { name: '编辑书签', exact: true })).toBeVisible();
  await bookmark.dispatchEvent('pointerup', touch);
  await assertLive({ main, child }); await capture('bookmark-long-press');
  await child.getByLabel('page-draft').click();
  await expect(popup.getByRole('menuitem', { name: '编辑书签', exact: true })).toBeHidden();
}

export async function verifyPasswords({ main, popup, child, capture }) {
  const username = child.getByLabel('username'), password = child.getByLabel('password');
  const entry = popup.locator('[data-browser-password-entry]').first();
  await username.click();
  await expect(entry).toBeVisible();
  expect(await username.evaluate(element => element === document.activeElement)).toBe(true);
  await child.keyboard.type('continue-typing');
  await expect(username).toHaveValue('continue-typing');
  await expect(entry).toBeVisible();
  await assertLive({ main, child }); await capture('password-suggestions');
  await entry.click();
  await expect(username).toHaveValue('popup-fixture@example.test');
  await expect(password).toHaveValue('fixture-only-secret');
  await expect(entry).toHaveCount(0);
  await password.click();
  await expect(entry).toBeVisible();
  await child.keyboard.press('Escape');
  await expect(entry).toHaveCount(0);
  await username.click();
  await expect(entry).toBeVisible();
  await child.keyboard.press('ArrowDown');
  await expect.poll(() => entry.evaluate(element => element === document.activeElement)).toBe(true);
  await popup.keyboard.press('Enter');
  await expect(entry).toHaveCount(0);
}

export async function verifyAddress({ main, popup, child, capture }) {
  const address = main.getByLabel('页面地址', { exact: true });
  await address.fill('127.0.0.1');
  const suggestions = popup.getByRole('listbox', { name: '历史记录', exact: true });
  await expect(suggestions).toBeVisible();
  expect(await address.evaluate(element => element === document.activeElement)).toBe(true);
  await address.press('ArrowDown');
  await expect(suggestions.locator('[aria-selected="true"]')).toHaveCount(1);
  await assertLive({ main, child }); await capture('address-suggestions');
  await address.press('Escape');
  await expect(suggestions).toHaveCount(0);
  await child.getByLabel('page-draft').click();
}
