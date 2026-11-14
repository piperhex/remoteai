import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) for (const enlarged of [false, true]) {
  test(`${mode} left submenus ${enlarged ? 'dark enlarged narrow' : 'light default wide'}`, async ({ page }, info) => {
    await page.setViewportSize({ width: enlarged ? 760 : 1440, height: 900 });
    await page.addInitScript(scope => localStorage.setItem(`remoteai:browser-bookmarks:bookmarks-${scope}`,
      JSON.stringify({ document: { revision: 0, entries: [
        { id: 'folder', kind: 'folder', title: '工作', url: '', parentId: '', position: 0 },
        { id: 'nested', kind: 'link', title: '使用指南', url: 'https://example.test/guide',
          parentId: 'folder', position: 0 },
        ...Array.from({ length: 24 }, (_, index) => ({ id: `item-${index}`, kind: 'link',
          title: `文档 ${index + 1}`, url: `https://example.test/${index}`, parentId: '', position: index + 1 })),
      ] } })), mode);
    await page.route('https://example.test/**', route => route.fulfill({ body: '<h1>Guide</h1>' }));
    await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}&mapping=1`
      + (enlarged ? '&dark=1&font=20' : ''));
    const settings = page.locator('.browser-bookmark-settings-popup');
    const toolbar = page.locator('.pm-browser-toolbar');
    await toolbar.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await expect(settings.getByRole('button', { name: '管理书签', exact: true })).toHaveCount(0);
    const all = settings.getByRole('button', { name: '所有书签', exact: true });
    await all.hover();
    const menu = page.getByRole('menu', { name: '所有书签', exact: true });
    await expect(menu).toBeVisible();
    await expect(page.locator('.browser-settings-submenu-popup:visible')).not.toHaveClass(/-appear|-enter/);
    await expect(menu.getByRole('menuitem').last()).toHaveText('管理书签');
    const parent = await settings.boundingBox(), bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThan(parent!.x);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    const footer = menu.getByRole('menuitem', { name: '管理书签', exact: true });
    expect((await footer.boundingBox())!.y).toBeLessThan(bounds!.y + bounds!.height);
    await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px'}-bookmarks.png`),
      animations: 'disabled' });
    await menu.getByRole('menuitem', { name: '工作', exact: true }).click();
    await expect(menu.getByRole('menuitem', { name: '使用指南', exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: '后退', exact: true }).click();
    await menu.getByRole('menuitem', { name: '工作', exact: true }).click();
    await menu.getByRole('menuitem', { name: '使用指南', exact: true }).click();
    await expect(settings).toBeHidden();
    await expect(toolbar.getByRole('textbox', { name: '页面地址', exact: true }))
      .toHaveValue('https://example.test/guide');
    await toolbar.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await all.focus(); await page.keyboard.press('ArrowLeft');
    await expect(menu.getByRole('menuitem', { name: '工作', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
    await expect(settings).toBeVisible(); await expect(all).toBeFocused();
    await all.press('Enter');
    await expect(menu.getByRole('menuitem', { name: '工作', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(footer).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '管理书签', exact: true })).toBeVisible();
    await expect(settings).toBeHidden();
  });
}
