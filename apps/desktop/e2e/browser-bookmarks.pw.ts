import { expect, test } from '@playwright/test';

test('folder bookmark context actions and manager drag sorting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('remoteai:browser-bookmarks:bookmarks-local', JSON.stringify({
    document: { revision: 0, entries: [
      { id: 'folder', kind: 'folder', title: '工作', url: '', parentId: '', position: 0 },
      { id: 'first', kind: 'link', title: '第一项', url: 'https://example.test/first', parentId: 'folder', position: 0 },
      { id: 'second', kind: 'link', title: '第二项', url: 'https://example.test/second', parentId: 'folder', position: 1 },
    ] },
  })));
  await page.goto('/e2e/browser-bookmarks-harness.html?mode=local');
  await page.locator('.browser-bookmark-item').filter({ hasText: '工作' }).click();
  await page.getByRole('menuitem', { name: '第一项', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑书签', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑书签', exact: true });
  await expect(editor.getByRole('textbox', { name: '名称' })).toHaveValue('第一项');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '浏览器设置', exact: true }).click();
  await page.getByRole('button', { name: '管理书签', exact: true }).click();
  await expect(page.locator('.ant-modal:visible')).not.toHaveClass(/-appear|-enter/);
  const rows = page.locator('.browser-bookmark-row');
  const first = rows.filter({ hasText: '第一项' }), second = rows.filter({ hasText: '第二项' });
  await first.locator('.browser-bookmark-row-name').hover();
  const source = await first.boundingBox(), target = await second.boundingBox();
  if (!source || !target) throw new Error('Manager drag targets are missing');
  await page.mouse.move(source.x + 30, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 30, target.y + target.height - 3, { steps: 8 });
  await expect(second).toHaveClass(/bookmark-drop-after/); await page.mouse.up();
  await expect(rows.locator('strong')).toHaveText(['工作', '第二项', '第一项']);
});

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode} ${enlarged ? 'dark narrow enlarged' : 'light wide'} bookmarks and settings`, async ({ page }, info) => {
      await page.setViewportSize({ width: enlarged ? 1000 : 1440, height: 900 });
      await page.route(/^https:\/\/(fonts\.|example\.test)/, route => route.fulfill({ contentType: 'text/html',
        body: '<body style="font:16px system-ui;padding:32px"><h1>Remote AI</h1><p>Browser preview</p></body>' }));
      await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}${enlarged ? '&dark=1&font=20' : ''}`,
        { waitUntil: 'domcontentloaded' });
      const browser = page.locator('.pm-browser');
      const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
      const nav = page.locator('.sidebar-nav-tools');
      await expect(nav.getByRole('button').first()).toHaveText('浏览器');
      await expect(nav.getByRole('button').nth(1)).toHaveText('在线交流');
      await address.fill('https://example.test/guide'); await address.press('Enter');
      await browser.getByRole('button', { name: '添加书签', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑书签', exact: true });
      await editor.getByRole('textbox', { name: '名称' }).fill('使用指南');
      await expect(page.locator('.ant-modal:visible')).not.toHaveClass(/-appear|-enter/);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-editor.png`) });
      await editor.getByRole('button', { name: /保\s*存/ }).click();
      await expect(browser.getByRole('button', { name: '使用指南', exact: false }).first()).toBeVisible();
      await browser.getByRole('button', { name: '浏览器设置', exact: true }).click();
      await expect(page.getByRole('switch', { name: '显示书签栏' })).toBeVisible();
      await expect(page.locator('.browser-bookmark-settings-popup:visible')).not.toHaveClass(/-appear|-enter/);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px-wide'}-settings.png`) });
      await page.getByRole('switch', { name: '显示书签栏' }).click();
      await expect(browser.getByRole('navigation', { name: '书签栏' })).toHaveCount(0);
      await page.getByRole('switch', { name: '显示书签栏' }).click();
      await page.getByRole('button', { name: '管理书签', exact: true }).click();
      const manager = page.getByRole('dialog', { name: '管理书签', exact: true });
      await manager.getByRole('button', { name: '书签文件夹', exact: true }).click();
      const folder = page.getByRole('dialog', { name: '书签文件夹', exact: true });
      await folder.getByRole('textbox', { name: '名称' }).fill('工作');
      await folder.getByRole('button', { name: /保\s*存/ }).click();
      await expect(folder).toBeHidden();
      await manager.getByRole('button', { name: 'Close', exact: true }).hover();
      await expect(page.locator('.ant-modal:visible')).not.toHaveClass(/-appear|-enter/);
      await expect(page.locator('.ant-modal:visible')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-manager.png`) });
      await manager.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(manager).toBeHidden();
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px-wide'}-bar.png`) });
      const bookmark = browser.locator('.browser-bookmark-item').filter({ hasText: '使用指南' });
      await bookmark.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '编辑书签' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeVisible();
      await expect(page.locator('.browser-bookmark-menu:visible')).not.toHaveClass(/-appear|-enter/);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-context-menu.png`) });
      await page.getByRole('menuitem', { name: '编辑书签' }).click();
      await editor.getByRole('textbox', { name: '名称' }).fill('使用指南（更新）');
      await editor.getByRole('button', { name: /保\s*存/ }).click();
      await expect(editor).toBeHidden();
      const folderButton = browser.locator('.browser-bookmark-item').filter({ hasText: '工作' });
      const source = await bookmark.boundingBox(), target = await folderButton.boundingBox();
      if (!source || !target) throw new Error('Bookmark drag targets are missing');
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width - 3, target.y + target.height / 2, { steps: 8 });
      await expect(folderButton).toHaveClass(/bookmark-drop-after/);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-drag.png`) });
      await page.mouse.up();
      await expect(browser.locator('.browser-bookmark-item')).toHaveText(['工作', '使用指南（更新）']);
      await expect(address).toHaveValue('https://example.test/guide');
      await folderButton.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '删除', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: '删除', exact: true });
      await expect(page.locator('.ant-modal:visible')).not.toHaveClass(/-appear|-enter/);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-delete.png`) });
      await confirmation.getByRole('button', { name: /删\s*除/, exact: true }).click();
      await expect(folderButton).toHaveCount(0);
      await page.keyboard.press('Escape'); await address.click();
      await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeHidden();
      await bookmark.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0,
        clientX: 230, clientY: 110 });
      await expect(page.getByRole('menuitem', { name: '编辑书签' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeVisible();
      await expect(page.locator('.browser-bookmark-menu:visible')).not.toHaveClass(/-appear|-enter/);
      await bookmark.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0 });
      await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}&sidebar=1${enlarged ? '&dark=1&font=20' : ''}`,
        { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.website-preview-browser .browser-bookmark-item').filter({ hasText: '使用指南' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px-wide'}-sidebar.png`) });
    });
  }
}
