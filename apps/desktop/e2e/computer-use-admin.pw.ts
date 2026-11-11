import { expect, test, type Page, type TestInfo } from '@playwright/test';

const url = '/e2e/computer-use-admin-harness.html';
async function capture(page: Page, info: TestInfo, name: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('transform', 'none');
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.getByRole('checkbox')).toBeEnabled();
  await expect(dialog.locator('.ant-checkbox')).toHaveClass(/ant-checkbox-checked/);
  await page.screenshot({ path: info.outputPath(name), animations: 'disabled' });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('keeps the original card height and saves opt-in without opening UAC', async ({ page }, info) => {
  await page.goto(`${url}?plain`);
  await expect(page.getByRole('button', { name: '停用', exact: true })).toBeVisible();
  const original = (await page.locator('.skill-card').boundingBox())!.height;
  await page.goto(url);
  const settings = page.getByRole('button', { name: '操作管理员窗口', exact: true });
  await expect(settings).toBeVisible();
  expect((await page.locator('.skill-card').boundingBox())!.height).toBe(original);
  await page.screenshot({ path: info.outputPath('windows-local-card-unchanged.png') });
  await settings.click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '0');
  await expect(page.getByRole('button', { name: '重新授权' })).toHaveCount(0);
  expect((await page.getByRole('dialog').boundingBox())!.width).toBeLessThanOrEqual(400);
  await capture(page, info, 'windows-local-opted-in-14px.png');
  await page.getByRole('checkbox').uncheck();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});

test('keeps cancellation feedback inside the dialog and allows an explicit retry', async ({ page }, info) => {
  await page.goto(`${url}?state=denied`);
  await page.getByRole('button', { name: '操作管理员窗口', exact: true }).click();
  const original = (await page.locator('.skill-card').boundingBox())!.height;
  await page.getByRole('button', { name: '重新授权', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未获得管理员授权');
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '1');
  await capture(page, info, 'windows-local-authorization-declined.png');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  expect((await page.locator('.skill-card').boundingBox())!.height).toBe(original);
  await expect(page.locator('.skill-card').getByRole('alert')).toHaveCount(0);
});

for (const language of ['zh', 'en', 'ru']) {
  test(`fits the authorized dialog at 24px in a narrow dark window: ${language}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 520, height: 860 });
    await page.goto(`${url}?state=active&dark&font=24&language=${language}`);
    await page.locator('.skill-card-title button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox')).toBeChecked();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(520);
    await capture(page, info, `windows-local-active-dark-24px-${language}.png`);
    await dialog.getByRole('checkbox').uncheck();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  });
}
