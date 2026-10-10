import { expect, test } from '@playwright/test';
import { navigate } from './chat-helpers';

test('switches appearance across pages and restores it after reloading', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await navigate(page, '设置');
  await expect(page.getByText('欢迎回来', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: /外观/ }).click();
  await page.getByRole('radio', { name: '暗黑', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.settings-group').first()).toHaveCSS('background-color', 'rgb(27, 32, 30)');
  await page.screenshot({ path: testInfo.outputPath('dark-settings.png'), fullPage: true });
  for (const label of ['账号', '设备', '2FA', '聊天']) {
    await navigate(page, label);
    if (label === '账号') {
      await expect(page.locator('.account-row').first()).toHaveCSS('background-color', 'rgb(27, 32, 30)');
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
  await page.getByRole('button', { name: /外观/ }).click();
  await expect(page.getByRole('radio', { name: '暗黑', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('dark-picker.png') });
  await page.getByRole('radio', { name: '明亮', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.settings-group').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: testInfo.outputPath('light-settings.png'), fullPage: true });
  expect(errors).toEqual([]);
});
