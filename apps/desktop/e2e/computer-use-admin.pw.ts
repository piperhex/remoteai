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

async function expectCenteredIcon(page: Page, authorized: boolean) {
  const button = page.locator('.skill-card-title button');
  const bounds = (await button.boundingBox())!;
  const icon = (await button.locator('svg').boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2)).toBeLessThan(0.5);
  expect(Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2)).toBeLessThan(0.5);
  const color = await button.evaluate(node => getComputedStyle(node).color);
  const [red, green] = color.match(/\d+/g)!.map(Number);
  expect(authorized ? green > red : red > green).toBe(true);
}

for (const gui of [false, true]) test(`first checkbox immediately requests authorization (GUI: ${gui})`,
  async ({ page }, info) => {
  // The first navigation includes the fixture's cold Vite dependency compilation.
  test.setTimeout(90_000);
  const suffix = gui ? '&gui' : '';
  await page.goto(`${url}?plain${suffix}`);
  await expect(page.getByRole('button', { name: '停用', exact: true })).toBeVisible();
  const original = (await page.locator('.skill-card').boundingBox())!.height;
  await page.goto(`${url}?${suffix}`);
  const settings = page.getByRole('button', { name: '操作管理员窗口', exact: true });
  await expect(settings).toBeVisible();
  // The compact GUI title grows from 22px to fit its existing 24px icon button.
  if (!gui) expect((await page.locator('.skill-card').boundingBox())!.height).toBe(original);
  await expectCenteredIcon(page, false);
  await page.screenshot({ path: info.outputPath('windows-local-permission-off-14px.png') });
  await settings.click();
  await expect(page.getByRole('dialog')).toContainText('勾选后会立即请求 Windows 授权');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '0');
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '1');
  await expect(page.getByRole('dialog')).toContainText('本次运行已获授权');
  await expectCenteredIcon(page, true);
  await expect(page.getByRole('button', { name: '重新授权' })).toHaveCount(0);
  expect((await page.getByRole('dialog').boundingBox())!.width).toBeLessThanOrEqual(400);
  await capture(page, info, 'windows-local-authorized-14px.png');
  await page.getByRole('checkbox').uncheck();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expectCenteredIcon(page, false);
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '1');
});

test('keeps cancellation feedback inside the dialog and allows an explicit retry', async ({ page }, info) => {
  await page.goto(`${url}?deny`);
  await page.getByRole('button', { name: '操作管理员窗口', exact: true }).click();
  const original = (await page.locator('.skill-card').boundingBox())!.height;
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('alert')).toContainText('未获得管理员授权');
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '1');
  await expectCenteredIcon(page, false);
  await expect(page.getByRole('button', { name: '重新授权', exact: true })).toBeVisible();
  await capture(page, info, 'windows-local-authorization-declined.png');
  await page.getByRole('button', { name: '重新授权', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-authorizations', '2');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  expect((await page.locator('.skill-card').boundingBox())!.height).toBe(original);
  await expect(page.locator('.skill-card').getByRole('alert')).toHaveCount(0);
});

for (const language of ['zh', 'en', 'ru']) {
  test(`fits the authorized dialog at 24px in a narrow dark window: ${language}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 520, height: 860 });
    await page.goto(`${url}?state=active&gui&dark&font=24&language=${language}`);
    await expectCenteredIcon(page, true);
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
    await expectCenteredIcon(page, false);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.screenshot({ path: info.outputPath(`windows-local-permission-off-dark-24px-${language}.png`),
      animations: 'disabled' });
  });
}
