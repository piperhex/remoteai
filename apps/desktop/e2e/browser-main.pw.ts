import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) for (const enlarged of [false, true]) {
  test(`${mode} main browser ${enlarged ? 'dark narrow enlarged' : 'light wide'}`, async ({ page }, info) => {
    await page.setViewportSize({ width: enlarged ? 900 : 1440, height: 900 });
    await page.context().route('http://127.0.0.1:18306/**', route => route.fulfill({ contentType: 'text/html',
      body: '<h1>Mapped website</h1><input aria-label="draft" value="original">' }));
    await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}&mapping=1${enlarged ? '&dark=1&font=20' : ''}`,
      { waitUntil: 'domcontentloaded' });
    const browser = page.locator('.browser-main-page');
    const settings = browser.getByRole('button', { name: '浏览器设置', exact: true });
    const menu = page.locator('.browser-bookmark-settings-popup');
    const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
    const screenshot = (state: string) => page.screenshot({
      path: info.outputPath(`${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px'}-${state}.png`),
      animations: 'disabled',
    });
    await settings.click();
    await expect(menu.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: '在浏览器中打开', exact: true })).toBeDisabled();
    await expect(menu.getByRole('checkbox', { name: '桌面版网站', exact: true })).toBeChecked();
    await expect(menu.getByRole('checkbox', { name: '桌面版网站', exact: true })).toBeDisabled();
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
    await screenshot('settings-blank');
    await menu.getByRole('button', { name: '端口映射', exact: true }).click();
    await expect(menu).toBeVisible();
    const mappings = page.getByRole('menu', { name: '端口映射', exact: true });
    await expect(mappings.locator('.browser-port-mappings button')).toHaveCount(1);
    await expect(page.locator('.browser-settings-submenu-popup:visible')).not.toHaveClass(/-appear|-enter/);
    await screenshot('mappings');
    const bounds = await mappings.boundingBox(), parent = await menu.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThan(parent!.x);
    await mappings.getByRole('menuitem', { name: /18306/ }).click();
    await expect(menu).toBeHidden();
    await expect(address).toHaveValue('http://127.0.0.1:18306/');
    const frame = browser.locator('.pm-browser-page:visible iframe').contentFrame();
    await frame.getByRole('textbox', { name: 'draft' }).fill('retained');
    await settings.click();
    await menu.getByRole('button', { name: '添加书签', exact: true }).click();
    await expect(menu.getByRole('button', { name: '添加书签', exact: true })).toBeDisabled();
    await screenshot('settings-page');
    const popupPromise = page.waitForEvent('popup');
    await menu.getByRole('button', { name: '在浏览器中打开', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL('http://127.0.0.1:18306/'); await popup.close();
    await settings.click();
    await page.locator('nav').getByRole('button', { name: 'Coze', exact: true }).click();
    await expect(browser).toBeHidden();
    await page.locator('nav').getByRole('button', { name: '浏览器', exact: true }).click();
    await expect(frame.getByRole('textbox', { name: 'draft' })).toHaveValue('retained');
    await browser.getByRole('button', { name: '新标签页', exact: true }).click();
    await expect(browser.getByRole('tab')).toHaveCount(2);
    await browser.getByRole('tab').first().click();
    await expect(address).toHaveValue('http://127.0.0.1:18306/');
    await screenshot('restored-tabs');
  });
}
