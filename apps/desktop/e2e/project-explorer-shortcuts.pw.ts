import { expect, test } from '@playwright/test';
import { explorerRoot, explorerShortcuts } from './project-explorer-fixture';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: host shortcuts precede drives and support navigation and selection`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    const shortcuts = page.locator('.pe-shortcuts button');
    await expect(shortcuts).toHaveText(['Home', '桌面', '下载']);
    const shortcutsBox = (await page.locator('.pe-shortcuts').boundingBox())!;
    const computerBox = (await page.locator('.pe-computer').boundingBox())!;
    expect(shortcutsBox.y + shortcutsBox.height).toBeLessThanOrEqual(computerBox.y);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-shortcuts/${mode}-light.png` });

    for (const [index, path] of Object.values(explorerShortcuts).entries()) {
      await page.getByRole('searchbox').fill('no-match');
      await shortcuts.nth(index).click();
      await expect(page.locator('.pe-footer input')).toHaveValue(path);
      await expect(shortcuts.nth(index)).toHaveAttribute('aria-current', 'location');
      await expect(page.getByRole('searchbox')).toHaveValue('');
      await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
    }
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.desktop);
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.downloads);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-shortcuts/${mode}-downloads.png` });
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
    await expect(page.getByTestId('selected-project')).toHaveText(explorerShortcuts.downloads);
  });

  test(`${mode}: compact dark shortcuts and offline language changes`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}&dark=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.locator('.pe-shortcuts button').nth(1).click();
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.desktop);
    expect(await page.locator('.pe-shell').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-shortcuts/${mode}-compact-dark.png` });
    await page.context().setOffline(true);
    for (const [locale, labels] of Object.entries({
      en: ['Home', 'Desktop', 'Downloads'], ja: ['ホーム', 'デスクトップ', 'ダウンロード'],
      ru: ['Домашняя папка', 'Рабочий стол', 'Загрузки'], zh: ['Home', '桌面', '下载'],
    })) {
      await page.evaluate(value => (window as unknown as { setExplorerLanguage: (value: string) => void })
        .setExplorerLanguage(value), locale);
      await expect(page.locator('.pe-shortcuts button')).toHaveText(labels);
    }
  });
}

test('older hosts keep drive navigation usable without guessing shortcut paths', async ({ page }) => {
  await page.route('**/e2e/project-explorer-fixture.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace('shortcuts: directory ? void 0 : explorerShortcuts', 'shortcuts: undefined') });
  });
  await page.goto('/e2e/project-explorer-harness.html?mode=remote', { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.locator('.pe-footer input')).toHaveValue(explorerRoot);
  for (const shortcut of await page.locator('.pe-shortcuts button').all()) await expect(shortcut).toBeDisabled();
  await page.locator('.pe-computer').click();
  await expect(page.getByRole('option')).toHaveCount(2);
});
