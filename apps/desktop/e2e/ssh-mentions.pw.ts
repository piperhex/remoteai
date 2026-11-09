import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) {
  for (const appearance of [{ width: 1280, large: false, dark: false },
    { width: 680, large: true, dark: true }]) {
    const label = `desktop-${mode}-${appearance.dark ? 'dark' : 'light'}-${appearance.width}`;
    test(`${label} SSH candidates filter, select and send`, async ({ page }) => {
      await page.setViewportSize({ width: appearance.width, height: 900 });
      await page.goto(`/e2e/ssh-mentions-harness.html?mode=${mode}`
        + `${appearance.large ? '&large' : ''}${appearance.dark ? '&dark' : ''}`);
      const editor = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await editor.fill('!');
      const popup = page.getByRole(mode === 'local' ? 'listbox' : 'menu', { name: '已保存的连接', exact: true });
      const options = popup.getByRole(mode === 'local' ? 'option' : 'menuitem');
      await expect(options).toHaveCount(2);
      expect((await popup.locator('..').boundingBox())!.width).toBeLessThanOrEqual(400);
      await page.screenshot({ path: `../../.codex-tmp/ssh-mentions/${label}-candidates.png` });
      await editor.fill('!开发'); await expect(options).toHaveCount(1);
      if (appearance.large) await options.first().click();
      else await editor.press('Tab');
      await expect(page.getByText('!开发服务器', { exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toHaveAttribute('data-sent');
      await page.screenshot({ path: `../../.codex-tmp/ssh-mentions/${label}-selected.png` });
      await editor.fill('检查磁盘空间');
      if (mode === 'local') await editor.press('Enter');
      else await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-sent');
      const input = JSON.parse((await page.locator('body').getAttribute('data-sent'))!);
      expect(input.attachments).toEqual([{ kind: 'ssh', name: '开发服务器', path: 'ssh-profile://development' }]);
    });
  }
  test(`${mode} empty and failed SSH lists consume Enter without sending`, async ({ page }) => {
    for (const state of ['empty', 'fail']) {
      await page.goto(`/e2e/ssh-mentions-harness.html?mode=${mode}&${state}`);
      const editor = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await editor.fill('!'); await editor.press('Enter');
      await expect(page.locator('body')).not.toHaveAttribute('data-sent');
      await editor.press('Escape');
      await expect(page.getByRole(mode === 'local' ? 'listbox' : 'menu', { name: '已保存的连接' })).toHaveCount(0);
    }
  });
}
