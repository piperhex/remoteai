import { expect, test } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import { openLoungeAction } from './lounge-mobile-actions';
import { openDesktopAvatarSettings } from './lounge-account-actions';

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: avatars save to the server, sync, reset and report failures`, async ({ page }) => {
    test.setTimeout(120_000);
    const mobile = mode === 'mobile';
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web);
    const enter = async () => {
      if (mobile) {
        await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
        await page.locator('.discovery-lounge').click();
        await page.getByRole('button', { name: '群聊', exact: true }).click();
      } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    };
    const openSettings = () => mobile ? openLoungeAction(page, '设置头像') : openDesktopAvatarSettings(page);
    const dialog = page.getByRole('dialog', { name: '设置头像' });
    const save = dialog.getByRole('button', { name: /^保\s*存$/ });
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await enter(); await openSettings();
    await expect(dialog.getByText('图片会裁剪为 128×128，保存后同步到各设备。')).toBeVisible();
    await page.locator('.lounge-avatar-settings input[type=file]').setInputFiles({ name: 'avatar.png',
      mimeType: 'image/png', buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    await expect(dialog.locator('.lounge-avatar img')).toBeVisible();
    relay.rejectAvatar(true); await save.click();
    await expect(dialog.getByRole('alert')).toHaveText('头像保存失败，请稍后重试。');
    expect(relay.savedAvatar()).toBe('');
    relay.rejectAvatar(false); await save.click(); await expect(dialog).toBeHidden();
    const avatar = relay.savedAvatar(); expect(avatar).toMatch(/^data:image\/png;base64,/);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await expect.poll(relay.count).toBe(2); await enter(); await openSettings();
    await expect(dialog.locator('.lounge-avatar img')).toHaveAttribute('src', avatar);
    await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
    relay.avatar(''); await openSettings();
    await expect(dialog.locator('.lounge-avatar')).toHaveText('AL');
    await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
    relay.avatar(avatar); await openSettings();
    await expect(dialog.locator('.lounge-avatar img')).toHaveAttribute('src', avatar);
    await dialog.getByRole('button', { name: '恢复默认头像' }).click(); await save.click();
    await expect(dialog).toBeHidden(); expect(relay.savedAvatar()).toBe('');
    await openSettings(); await expect(dialog.locator('.lounge-avatar')).toHaveText('AL');
    expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(400);
    await expect(dialog).not.toHaveClass(/ant-zoom/);
    await expect(dialog).toHaveCSS('opacity', '1');
    await dialog.screenshot({ path: `../../.codex-tmp/lounge-avatar-${mode}.png` });
    expect(relay.sent).toHaveLength(0);
  });
}
