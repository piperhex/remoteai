import { openLanguageSettings, languageOption } from './language-settings';
import { expect, test, type Page } from '@playwright/test';
import { navigate } from './chat-helpers';
import { testText } from '../../../scripts/i18n-fixture.mjs';

async function openSettings(page: Page) {
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await navigate(page, '设置');
  await expect(page.getByText('欢迎回来', { exact: true })).not.toBeVisible();
}

test('switches appearance across pages and restores it after reloading', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openSettings(page);
  if (testInfo.project.name !== 'desktop') await page.getByRole('button', { name: /外观/ }).click();
  await page.getByText('暗黑', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.settings-group').first()).toHaveCSS('background-color', 'rgb(27, 32, 30)');
  await page.screenshot({ path: testInfo.outputPath('dark-settings.png'), fullPage: true });
  for (const label of ['账号', '发现', '设备', '2FA', '聊天']) {
    await navigate(page, label);
    if (label === '账号') {
      await expect(page.locator('.account-row').first()).toHaveCSS('background-color', 'rgb(27, 32, 30)');
    }
    if (label === '发现') {
      await expect(page.locator('.discovery-page')).toHaveCSS('background-color', 'rgb(18, 22, 20)');
      await expect(page.locator('.discovery-row').first()).toHaveCSS('background-color', 'rgb(27, 32, 30)');
    }
    if (label === '聊天') {
      await expect(page.locator('.chat-page')).toHaveCSS('background-color', 'rgb(18, 22, 20)');
      await expect(page.locator('.chat-page')).toHaveCSS('color', 'rgb(230, 232, 235)');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dark-${label}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await navigate(page, '设置');
  if (testInfo.project.name !== 'desktop') await page.getByRole('button', { name: /外观/ }).click();
  await expect(page.getByRole('radio', { name: '暗黑', exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('dark-picker.png') });
  await page.getByText('明亮', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.settings-group').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: testInfo.outputPath('light-settings.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('defaults to system appearance and follows changes until a manual choice is made', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'The system option belongs to mobile settings.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: /外观/ })).toContainText('跟随系统');
  await page.getByRole('button', { name: /外观/ }).click();
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('system-dark-picker.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('system-light-picker.png') });
  await page.getByRole('radio', { name: '明亮', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await navigate(page, '设置');
  await page.getByRole('button', { name: /外观/ }).click();
  await page.getByRole('radio', { name: '跟随系统', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('codex-switch.web.theme.v1'))).toBe('system');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('uses the system theme for invalid preferences and synchronizes cleared storage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('codex-switch.web.theme.v1', 'invalid'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'codex-switch.web.theme.v1', newValue: 'light',
  })));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('shows the system preference in every released language while offline', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'The system option belongs to mobile settings.');
  await openSettings(page);
  await context.setOffline(true);
  for (const [language, label] of [['en', 'English'], ['ru', 'Русский'], ['ja', '日本語'], ['zh', '简体中文']]) {
    await openLanguageSettings(page);
    await languageOption(page, label).click();
    const appearance = testText('client.workspaceSettings.appearance', {}, language);
    const system = testText('client.settings.followSystem', {}, language);
    await page.getByRole('button', { name: new RegExp(appearance) }).click();
    await expect(page.getByRole('radio', { name: system, exact: true })).toBeChecked();
    await page.getByRole('radio', { name: system, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
