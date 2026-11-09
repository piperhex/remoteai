import { expect, test, type Locator } from '@playwright/test';

async function longPress(tab: Locator) {
  const bounds = (await tab.boundingBox())!;
  await tab.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, isPrimary: true,
    clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 });
  await expect(tab).toHaveAttribute('aria-expanded', 'true');
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: terminal context menus close groups with right-click, long-press and keyboard`,
    async ({ page }, info) => {
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto(`/e2e/ssh-harness.html?mode=${mode}&cloud=1`);
      await page.getByRole('button', { name: mode === 'web' ? '打开远程终端' : '打开终端', exact: true }).click();
      const strip = page.getByRole('tablist', { name: '终端标签页' });
      const tabs = strip.getByRole('tab');
      const add = page.getByRole('button', { name: '新建终端', exact: true });
      for (let count = 2; count <= 4; count++) {
        await add.click(); await expect(tabs).toHaveCount(count);
      }
      const ids = await tabs.evaluateAll(elements => elements.map(element => element.id));
      await tabs.nth(1).click({ button: 'right' });
      const menu = page.getByRole('menu', { name: '标签页操作' });
      await expect(menu).toBeVisible();
      await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
      expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
      await page.screenshot({ path: info.outputPath(`${mode}-light-right-click.png`), animations: 'disabled' });
      await menu.getByRole('menuitem', { name: '关闭右侧标签页', exact: true }).click();
      await expect(menu).toBeHidden();
      await expect(tabs).toHaveCount(2);
      expect(await tabs.evaluateAll(elements => elements.map(element => element.id))).toEqual(ids.slice(0, 2));
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await add.click(); await expect(tabs).toHaveCount(3);
      await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.setViewportSize({ width: 900, height: 900 });
      await page.evaluate(() => {
        localStorage.setItem('codex-switch:global-font-size', '20');
        window.dispatchEvent(new Event('codex-switch:gui-appearance-changed'));
      });
      await longPress(tabs.nth(1));
      await expect(menu).toBeVisible();
      await tabs.nth(1).dispatchEvent('pointerup', { pointerType: 'touch', button: 0, isPrimary: true });
      await tabs.nth(1).dispatchEvent('click');
      await expect(menu).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-dark-long-press.png`), animations: 'disabled' });
      await menu.getByRole('menuitem', { name: '关闭其他标签页', exact: true }).click();
      await expect(tabs).toHaveCount(1);
      await expect(tabs.first()).toHaveAttribute('id', ids[1]);
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
      await tabs.first().focus(); await tabs.first().press('Shift+F10');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveCount(2);
      for (const action of await menu.getByRole('menuitem').all()) await expect(action).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden(); await expect(tabs.first()).toBeFocused();
      await tabs.first().click({ button: 'right' }); await expect(menu).toBeVisible();
      await page.getByRole('button', { name: '收起终端', exact: true }).click();
      await expect(menu).toBeHidden();
    });
}
