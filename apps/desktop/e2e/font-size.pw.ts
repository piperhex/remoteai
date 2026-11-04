import { expect, test, type Page } from '@playwright/test';

const globalSize = (page: Page) => page.getByRole('spinbutton', { name: '全局字号', exact: true });
const guiSize = (page: Page) => page.getByRole('spinbutton', { name: '字体大小', exact: true });
const following = (page: Page) => page.getByRole('switch', { name: '跟随全局字号', exact: true });
const reply = (page: Page) => page.getByTestId('conversation').getByText('正文应清晰易读，字号调整后立即生效。');

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

test('global size, customization and follow toggle persist across reloads', async ({ page }, info) => {
  await page.goto(`e2e/font-size-harness.html?mode=${info.project.name}`, { waitUntil: 'domcontentloaded' });
  await expect(following(page)).toBeChecked();
  await expect(reply(page)).toHaveCSS('font-size', '14px');
  await globalSize(page).fill('20'); await globalSize(page).press('Tab');
  await expect(guiSize(page)).toHaveValue('20');
  await expect(reply(page)).toHaveCSS('font-size', '20px');
  await expect(page.getByRole('button', { name: '常用控件' })).toHaveCSS('font-size', '20px');
  await guiSize(page).fill('18'); await guiSize(page).press('Tab');
  await expect(following(page)).not.toBeChecked();
  await globalSize(page).fill('24'); await globalSize(page).press('Tab');
  await expect(reply(page)).toHaveCSS('font-size', '18px');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(globalSize(page)).toHaveValue('24');
  await expect(guiSize(page)).toHaveValue('18');
  await expect(following(page)).not.toBeChecked();
  await following(page).click();
  await expect(reply(page)).toHaveCSS('font-size', '24px');
  await expect(page.getByTestId('conversation').getByText('const fontSize = 18;')).toHaveCSS('font-size', '22px');
  if (info.project.name !== 'local') {
    await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveCSS('font-size', '24px');
  }
  await page.screenshot({ path: `../../.codex-tmp/font-size-${info.project.name}.png`,
    fullPage: true, animations: 'disabled' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(following(page)).toBeChecked();
  await expect(guiSize(page)).toHaveValue('24');
  await following(page).click();
  await globalSize(page).fill('16'); await globalSize(page).press('Tab');
  await expect(reply(page)).toHaveCSS('font-size', '24px');
  await page.locator('.font-harness-settings').getByRole('button', { name: '恢复默认' }).click();
  await expect(reply(page)).toHaveCSS('font-size', '14px');
  await expect(following(page)).not.toBeChecked();
  await following(page).click();
  await expect(reply(page)).toHaveCSS('font-size', '16px');
});

test('wraps large text and controls within narrower windows', async ({ page }, info) => {
  const width = info.project.name === 'web' ? 390 : 900;
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`e2e/font-size-harness.html?mode=${info.project.name}`, { waitUntil: 'domcontentloaded' });
  await globalSize(page).fill('24'); await globalSize(page).press('Tab');
  await expect(following(page)).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const control = page.locator('.font-harness-settings .font-size-control');
  const box = await control.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `../../.codex-tmp/font-size-${info.project.name}-narrow.png`,
    fullPage: true, animations: 'disabled' });
});

test('keeps legacy preferences and switches language without losing custom size', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch:gui-font-size', '19');
    localStorage.setItem('codex-switch:global-font-size', '22');
  });
  await page.goto(`e2e/font-size-harness.html?mode=${info.project.name}`, { waitUntil: 'domcontentloaded' });
  await expect(following(page)).not.toBeChecked();
  await expect(reply(page)).toHaveCSS('font-size', '19px');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Follow global font size' })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Global font size', exact: true })).toHaveValue('22');
  await expect(reply(page)).toHaveCSS('font-size', '19px');
  if (info.project.name !== 'local') {
    await page.getByRole('button', { name: 'Codex GUI settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('switch')).not.toBeChecked();
  }
});
