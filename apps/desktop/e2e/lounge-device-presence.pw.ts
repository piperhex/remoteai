import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';
import { fileURLToPath } from 'node:url';

const green = 'rgb(34, 197, 94)';
const red = 'rgb(239, 68, 68)';
const desktop = { version: '2.2.7', platform: 'desktop' as const };
const mobile = { version: '1.5.3', platform: 'mobile' as const };
const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
const screenshots = new URL('../../../.codex-tmp/mobile-device-presence/', import.meta.url);

async function capture(page: Page, label: string) {
  await expect(page.locator('.adm-toast-mask')).toBeHidden();
  await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, screenshots)), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function expectDevices(heading: Locator, platforms: string[]) {
  await expect(heading.locator('.lounge-members-trigger')).toHaveCount(0);
  await expect(heading.locator('.lounge-client-version-item.is-online')).toHaveCount(platforms.length);
  for (const platform of platforms) {
    await expect(heading.locator(`[data-client-platform="${platform}"] svg`)).toHaveCSS('color', green);
  }
}

for (const width of [320, 390]) for (const fontSize of [14, 24]) {
  test(`mobile devices ${width} ${fontSize}px: live device icons and legacy status`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('codex-switch:global-font-size', String(value)), fontSize);
    const relay = await setupLounge(page, true);
    relay.names.enabled = true;
    relay.names.nicknames.set('bob', 'Jia');
    await page.goto(webURL); await relay.ready();
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    relay.private('设备状态测试', { id: 'bob', account: 'bob@example.test', nickname: 'Jia' });
    await page.getByRole('button', { name: '与 Jia 私聊', exact: true }).click();
    const heading = page.locator('.lounge-mobile-heading.lounge-heading');
    const fallback = heading.locator('.lounge-members-trigger');
    const label = `${width}-${fontSize}`;
    await expect(fallback).toHaveText('在线');
    await expect(fallback.locator('i')).toHaveCSS('background-color', green);
    await capture(page, `${label}-legacy-online`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => window.dispatchEvent(new StorageEvent('storage', {
        key: 'codex-switch.web.theme.v1', newValue: value,
      })), theme);
      relay.versions(['2.2.7', '1.5.3'], [desktop, mobile]);
      await expectDevices(heading, ['desktop', 'mobile']);
      await capture(page, `${label}-${theme}-both-online`);
      await heading.locator('.lounge-heading-account').click();
      const profile = page.locator('.lounge-profile');
      await expect(profile.locator('.lounge-profile-status')).toHaveCount(0);
      await expect(profile.locator('.lounge-client-version-item.is-online')).toHaveCount(2);
      await expect(profile).toBeInViewport();
      await expect(page.locator('.lounge-profile-drawer .ant-drawer-content-wrapper'))
        .not.toHaveClass(/-(enter|appear|leave)/);
      await capture(page, `${label}-${theme}-profile`);
      await page.getByRole('button', { name: '返回', exact: true }).click();
    }
    relay.versions(['1.5.3'], [mobile]);
    await expectDevices(heading, ['mobile']);
    await expect(heading.locator('[data-client-platform="desktop"]')).toHaveCount(0);
    await capture(page, `${label}-phone-only`);
    relay.versions(['2.2.7'], [desktop]);
    await expectDevices(heading, ['desktop']);
    await expect(heading.locator('[data-client-platform="mobile"]')).toHaveCount(0);
    await capture(page, `${label}-desktop-only`);
    relay.contact(false);
    await expect(fallback).toHaveText('离线');
    await expect(fallback.locator('i')).toHaveCSS('background-color', red);
    await expect(heading.locator('.is-online')).toHaveCount(0);
    relay.versions([], []);
    await expect(heading.locator('.lounge-client-version')).toHaveCount(0);
    await capture(page, `${label}-offline`);
    relay.contact(true);
    relay.versions(['2.2.7'], [{ version: '2.2.7' }]);
    await expect(fallback).toHaveText('在线');
    await expect(fallback.locator('i')).toHaveCSS('background-color', green);
    await capture(page, `${label}-legacy-version`);
    relay.versions(['2.2.7'], [desktop]);
    relay.contact(null);
    await expect(fallback).toHaveText('在线状态不可见');
    await expect(heading.locator('.is-online')).toHaveCount(0);
    relay.contact(true);
    await expectDevices(heading, ['desktop']);
    relay.offline(); relay.close();
    await expect(fallback).toBeVisible();
    await expect(heading.locator('.lounge-client-version-item.is-online')).toHaveCount(0);
  });
}
