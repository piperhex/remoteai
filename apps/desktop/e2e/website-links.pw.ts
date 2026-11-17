import { test, expect } from '@playwright/test';
import { longPress } from './project-browser-touch';

for (const mode of ['local', 'remote']) for (const enlarged of [false, true]) {
  test(`${mode} link destinations ${enlarged ? 'dark enlarged narrow' : 'light wide'}`, async ({ page }, info) => {
    await page.setViewportSize({ width: enlarged ? 1000 : 1440, height: 900 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.context().route('**/preview-site/**', route => route.fulfill({
      contentType: 'text/html', body: '<h1>Website link preview</h1>',
    }));
    await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}${enlarged ? '&dark=1&font=20' : ''}`);
    const link = page.getByRole('link', { name: '使用指南' });
    const url = await link.getAttribute('href');
    const menu = page.getByRole('menu');
    const openMenu = () => link.click({ button: 'right' });
    await openMenu();
    await expect(menu.getByRole('menuitem')).toHaveText(['右侧边浏览器', '独立内置浏览器', '外部浏览器', '复制链接']);
    await expect(menu.getByRole('menuitem').first()).toHaveCSS('font-size', enlarged ? '16px' : '12px');
    const bounds = (await menu.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: info.outputPath(`${mode}-right-click-menu.png`), animations: 'disabled' });
    await menu.getByRole('menuitem', { name: '复制链接' }).click();
    await expect(menu).toBeHidden();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await longPress(page, link, '');
    await expect(menu.getByRole('menuitem')).toHaveText(['右侧边浏览器', '独立内置浏览器', '外部浏览器', '复制链接']);
    await expect(page.locator('.website-preview-browser')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${mode}-long-press-menu.png`), animations: 'disabled' });
    await menu.getByRole('menuitem', { name: '右侧边浏览器' }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.pm-browser-page:visible iframe').contentFrame()
      .getByRole('heading', { name: 'Website link preview' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-sidebar-browser.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    await link.focus(); await link.press('Shift+F10'); await expect(menu).toBeVisible();
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
    await openMenu(); await menu.getByRole('menuitem', { name: '独立内置浏览器' }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.browser-main-page .pm-browser-page:visible iframe').contentFrame()
      .getByRole('heading', { name: 'Website link preview' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-standalone-browser.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '返回会话' }).click();
    await openMenu(); const popupPromise = page.waitForEvent('popup');
    await menu.getByRole('menuitem', { name: '外部浏览器' }).click();
    const popup = await popupPromise; await expect(popup).toHaveURL(url!); await popup.close();
  });
}
