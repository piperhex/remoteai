import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';

const versionLabel = 'v2.2.7 · v1.5.3';

async function openMenu(page: Page, target: Locator, touch: boolean) {
  await expect(page.getByRole('menu')).toBeHidden();
  if (!touch) await target.click({ button: 'right' });
  else {
    const box = (await target.boundingBox())!;
    const pointer = { pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await target.dispatchEvent('pointerdown', pointer);
    await expect(page.getByRole('menu')).toBeVisible();
    await target.dispatchEvent('pointerup', pointer);
  }
  await expect(page.getByRole('menu')).toHaveCount(1);
}

for (const mode of ['local', 'remote', 'web', 'mobile-320', 'mobile-390']) {
  for (const fontSize of [14, 24]) test(`${mode} ${fontSize}px: live peer versions and group profiles`, async ({ page }) => {
    const mobile = mode.startsWith('mobile');
    const web = mobile || mode === 'web';
    await page.setViewportSize({ width: mobile ? Number(mode.split('-')[1]) : fontSize === 24 ? 960 : 1440,
      height: mobile ? 844 : 900 });
    await page.addInitScript(value => localStorage.setItem('codex-switch:global-font-size', String(value)), fontSize);
    const relay = await setupLounge(page, web);
    relay.names.enabled = true;
    relay.names.nicknames.set('bob', fontSize === 24 ? '这是一位名字很长的联系人' : 'Jia');
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    expect(relay.reportedVersions[0]).toMatch(/^\d+\.\d+\.\d+/);
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    relay.push('群聊资料与版本测试');
    const bubble = page.locator('.lounge-message').filter({ hasText: '群聊资料与版本测试' }).locator('.lounge-bubble');
    const profile = page.locator(mobile ? '.lounge-profile' : '.lounge-desktop-profile-dialog');
    const title = page.locator('.lounge-heading');
    await openMenu(page, bubble, false);
    await page.getByRole('menuitem', { name: '个人资料', exact: true }).hover();
    await page.screenshot({ path: `../../.codex-tmp/peer-version/${mode}-${fontSize}-group-menu.png` });
    await page.getByRole('menuitem', { name: '个人资料', exact: true }).click();
    await expect(profile).toBeVisible();
    await expect(profile.locator('.lounge-client-version')).toHaveCount(0);
    relay.versions(['2.2.7', '1.5.3', '2.2.7'], [
      { version: '1.5.3', platform: 'mobile' }, { version: '2.2.7', platform: 'desktop' },
      { version: '2.2.7', platform: 'desktop' },
    ]);
    await expect(profile.locator('.lounge-client-version')).toContainText(versionLabel);
    await expect(profile.locator('[data-client-platform="desktop"] svg')).toBeVisible();
    await expect(profile.locator('[data-client-platform="mobile"] svg')).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        if (window.loungeFixture) window.loungeFixture.setTheme(value as 'light' | 'dark');
        else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: value }));
      }, theme);
      await profile.locator('.lounge-client-version').hover();
      await page.screenshot({ path: `../../.codex-tmp/peer-version/${mode}-${fontSize}-${theme}-profile.png`,
        animations: 'disabled' });
    }
    if (mobile) await page.getByRole('button', { name: '返回', exact: true }).click();
    else await page.locator('.ant-modal-close').click();
    await openMenu(page, bubble, true);
    await page.getByRole('menuitem', { name: '个人资料', exact: true }).click();
    await expect(profile.locator('.lounge-client-version')).toContainText(versionLabel);
    if (mobile) {
      await page.getByRole('button', { name: '发消息', exact: true }).click();
    } else {
      await page.locator('.ant-modal-close').click();
      const avatar = page.locator('.lounge-message').filter({ hasText: '群聊资料与版本测试' }).locator('.lounge-avatar');
      await openMenu(page, avatar, false);
      await page.getByRole('menuitem', { name: '个人资料', exact: true }).click();
      await expect(profile.locator('.lounge-client-version')).toContainText(versionLabel);
      await page.locator('.ant-modal-close').click();
      await page.locator('.lounge-message .lounge-avatar').first().click();
    }
    await expect(title.locator('.lounge-client-version')).toHaveText(versionLabel);
    await expect(page.locator('.adm-toast-mask')).toBeHidden();
    const bounds = await title.locator('.lounge-client-version').boundingBox();
    const heading = (await title.boundingBox())!;
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(heading.x + heading.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(heading.y + heading.height);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        if (window.loungeFixture) window.loungeFixture.setTheme(value as 'light' | 'dark');
        else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: value }));
      }, theme);
      await title.locator('.lounge-client-version').hover();
      await page.screenshot({ path: `../../.codex-tmp/peer-version/${mode}-${fontSize}-${theme}-private.png`,
        animations: 'disabled' });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    relay.versions(['2.2.8'], [{ version: '2.2.8', platform: 'desktop' }]);
    await expect(title.locator('.lounge-client-version')).toHaveText('v2.2.8');
    relay.versions([]);
    await expect(title.locator('.lounge-client-version')).toHaveCount(0);
  });
}
