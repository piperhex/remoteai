import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web']) for (const large of [false, true]) {
  test(`${mode} ${large ? 'dark narrow enlarged' : 'light wide default'} extensions`, async ({ page }, info) => {
    await page.setViewportSize({ width: large ? 960 : 1440, height: 900 });
    await page.goto(`/e2e/browser-extensions-harness.html?mode=${mode}${large ? '&dark=1&font=20' : ''}`);
    await page.getByRole('button', { name: '扩展程序', exact: true }).click();
    await expect(page.getByText('Remote AI 浏览器助手', { exact: true })).toBeVisible();
    await expect(page.getByText('Page marker', { exact: true })).toBeVisible();
    await expect(page.locator('.browser-extension-builtin img')).toBeVisible();
    await expect.poll(() => page.locator('.browser-extension-builtin img')
      .evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('extensions-menu.png') });
    await page.getByRole('button', { name: '固定到工具栏: Page marker', exact: true }).click();
    await expect(page.locator('.browser-extensions-toolbar > button[aria-label="Page marker"]')).toBeVisible();
    await page.getByRole('button', { name: '管理扩展程序', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('AI 优先使用 Chrome', { exact: false })).toBeVisible();
    await dialog.getByRole('switch', { name: '停用扩展: Page marker' }).click();
    await expect(dialog.getByRole('switch', { name: '启用扩展: Page marker' })).not.toBeChecked();
    await expect(page.locator('.browser-extensions-menu')).toBeHidden();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('extensions-manager.png') });
    await dialog.getByRole('button', { name: '从 Chrome 导入', exact: true }).click();
    await expect(dialog.getByText('Default · 1.0')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('extensions-chrome-import.png') });
    await dialog.getByRole('button', { name: '安装', exact: true }).click();
    await expect(dialog.getByText('Imported extension', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '浏览文件', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '选择扩展文件或文件夹', exact: true });
    await picker.getByRole('option', { name: 'C:/', exact: false }).dblclick();
    await picker.getByRole('option', { name: 'invalid.zip', exact: false }).click();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('extensions-file-browser.png') });
    await picker.getByRole('button', { name: '安装', exact: true }).click();
    await expect(dialog.getByText('无法读取扩展', { exact: false })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('extensions-unpacked-error.png') });
    const dropped = await page.evaluateHandle(() => {
      const data = new DataTransfer(); data.items.add(new File(['extension'], 'extension.zip')); return data;
    });
    await dialog.locator('.browser-extension-drop').dispatchEvent('drop', { dataTransfer: dropped });
    await expect(dialog.getByText('无法读取扩展', { exact: false })).toBeHidden();
    await expect(dialog.getByText('Imported extension', { exact: true })).toHaveCount(2);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test('unsupported host and English offline copy', async ({ page }) => {
  await page.goto('/e2e/browser-extensions-harness.html?mode=web&unsupported=1&en=1');
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Manage extensions', exact: true }).click();
  await expect(page.getByText('This device does not support installing Chrome extensions yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import from Chrome', exact: true })).toBeDisabled();
  await expect(page.getByText('AI uses Chrome first', { exact: false })).toBeVisible();
});
