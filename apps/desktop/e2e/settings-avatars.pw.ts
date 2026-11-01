import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setupLounge } from './lounge-support';
import type {} from './lounge-harness';

const avatarImage = readFileSync(new URL('../src-tauri/icons/128x128.png', import.meta.url));

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark' : 'light'}: settings avatar shares the chat profile`, async ({ page }) => {
      const mobile = mode === 'mobile';
      const web = mode === 'web' || mobile;
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const relay = await setupLounge(page, web);
      await page.addInitScript(dark => {
        localStorage.setItem('codex-switch.web.theme.v1', dark ? 'dark' : 'light');
      }, dark);
      await page.goto(web ? 'http://127.0.0.1:1486/web/'
        : `/e2e/lounge-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
      await relay.ready();
      const nav = page.locator(mobile ? '.mobile-tabbar' : web ? '.desktop-sidebar' : '.app-sidebar');
      await nav.getByText('设置', { exact: true }).click();
      const profile = page.locator(web ? '.settings-profile' : '.cloud-account-identity');
      const edit = profile.getByRole('button', { name: '修改头像', exact: true });
      await expect(profile.locator('strong')).toHaveText(mobile ? 'alice@example.test' : 'alice');
      const dialog = page.getByRole('dialog', { name: '设置头像' });
      await edit.click();
      await expect(dialog.getByText(/128×128/)).toBeVisible();
      await page.locator('.lounge-avatar-settings input[type=file]').setInputFiles({ name: 'avatar.png',
        mimeType: 'image/png', buffer: avatarImage });
      await expect(dialog.locator('.lounge-avatar img')).toBeVisible();
      await expect.poll(() => dialog.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(128);
      const save = dialog.getByRole('button', { name: /^保\s*存$/ });
      relay.rejectAvatar(true); await save.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(profile.locator('img')).toHaveCount(0);
      relay.rejectAvatar(false); await save.click(); await expect(dialog).toBeHidden();
      const avatar = relay.savedAvatar();
      await expect(profile.locator('img')).toHaveAttribute('src', avatar);
      if (!web) {
        await expect(page.locator('.cloud-avatar-button > span').last()).toHaveText('alice');
        await expect(page.locator('.cloud-avatar-button img')).toHaveAttribute('src', avatar);
      }
      const label = `settings-avatar-${mode}-${dark ? 'dark' : 'light'}`;
      await page.screenshot({ path: `../../.codex-tmp/${label}.png` });
      await edit.click();
      await expect(dialog).not.toHaveClass(/ant-zoom/);
      await expect(dialog).toHaveCSS('opacity', '1');
      await dialog.screenshot({ path: `../../.codex-tmp/${label}-editor.png` });
      await dialog.getByRole('button', { name: '恢复默认头像' }).click(); await save.click();
      await expect(dialog).toBeHidden(); expect(relay.savedAvatar()).toBe('');
      await expect(profile.locator('img')).toHaveCount(0);
      relay.avatar(avatar); await expect(profile.locator('img')).toHaveAttribute('src', avatar);
      await page.reload(); await relay.ready();
      if (!(await edit.isVisible())) await nav.getByText('设置', { exact: true }).click();
      await expect(profile.locator('img')).toHaveAttribute('src', avatar);
      await profile.getByRole('button', { name: '查看用户信息', exact: true }).click();
      await expect(page.getByText('alice@example.test', { exact: true }).last()).toBeVisible();
      expect(relay.sent).toHaveLength(0);
    });
  }
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: compact settings keeps avatar and account actions accessible`, async ({ page }) => {
    const web = mode === 'web';
    const relay = await setupLounge(page, web);
    await page.setViewportSize({ width: web ? 1024 : 1200, height: 768 });
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    await page.locator(web ? '.desktop-sidebar' : '.app-sidebar').getByText('设置', { exact: true }).click();
    relay.avatar(`data:image/png;base64,${avatarImage.toString('base64')}`);
    const profile = page.locator(web ? '.settings-profile' : '.cloud-account-identity');
    await expect(profile.locator('img')).toBeVisible();
    await expect(profile.getByRole('button', { name: '查看用户信息', exact: true })).toBeInViewport();
    await page.screenshot({ path: `../../.codex-tmp/settings-avatar-${mode}-compact.png` });
  });
}

test('avatar editor keeps all released translations available offline', async ({ page }) => {
  const relay = await setupLounge(page);
  await page.goto('/e2e/lounge-harness.html'); await relay.ready();
  await page.locator('.app-sidebar').getByText('设置', { exact: true }).click();
  relay.offline(); relay.close();
  for (const language of ['en', 'ja', 'ru', 'zh'] as const) {
    await page.evaluate(language => window.loungeFixture.setLanguage(language), language);
    await page.locator('.account-avatar-edit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/128×128/)).toBeVisible();
    await expect(dialog).not.toContainText('client.lounge.');
    await dialog.locator('.ant-modal-close').click();
    await expect(dialog).toBeHidden();
  }
});
