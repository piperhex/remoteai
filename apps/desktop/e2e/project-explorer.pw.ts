import { expect, test, type Page } from '@playwright/test';
import { explorerRoot } from './project-explorer-fixture';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

async function open(page: Page, mode = 'local', query = '') {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}${query}`, { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
}
const option = (page: Page, name: string) => page.locator(`.pe-entry[data-path="${explorerRoot}/${name}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: real picker entry, exact size, navigation, search and folder selection`, async ({ page }) => {
    await open(page, mode);
    const box = await page.locator('.ant-modal-content').boundingBox();
    expect(box!.width).toBeCloseTo(1600 * .85, 0);
    expect(box!.height).toBeCloseTo(1000 * .85, 0);
    const footer = (await page.locator('.pe-footer').boundingBox())!;
    expect(footer.y + footer.height).toBeCloseTo(box!.y + box!.height, 0);
    await expect(page.locator('.pe-columns button')).toContainText(['名称', '修改日期', '类型', '大小']);
    await option(page, '.qoder').click();
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-preview/${mode}-details.png` });
    await page.getByRole('searchbox').fill('README');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('searchbox').fill('');
    await option(page, 'docs').dblclick();
    await expect(page.locator('.pe-footer input')).toHaveValue(`${explorerRoot}/docs`);
    await button(page, '后退').click();
    await expect(option(page, 'docs')).toBeVisible();
    await button(page, '前进').click();
    await expect(page.locator('.pe-footer input')).toHaveValue(`${explorerRoot}/docs`);
    await button(page, '向上一级').click();
    await expect(option(page, 'docs')).toBeVisible();
    await option(page, 'scripts').click();
    await button(page, '选择文件夹').click();
    await expect(page.locator('.project-explorer-modal')).toHaveCount(0);
    await expect(page.getByTestId('selected-project')).toHaveText(`${explorerRoot}/scripts`);
    expect(await page.evaluate(() => (window as unknown as { explorerCalls: object[] }).explorerCalls))
      .toContainEqual({ operation: 'projectDirectories', directory: explorerRoot, includeFiles: true });
  });
}

test('eight views, sorting, details and right-click view submenu', async ({ page }) => {
  await open(page);
  const views = ['超大图标', '大图标', '中等图标', '小图标', '列表', '详细信息', '平铺', '内容'];
  const classes = ['extraLarge', 'large', 'medium', 'small', 'list', 'details', 'tiles', 'content'];
  for (let index = 0; index < views.length; index++) {
    await button(page, '查看').click();
    await page.getByRole('menuitem', { name: views[index], exact: true }).click();
    await expect(page.locator(`.pe-view-${classes[index]}`)).toBeVisible();
    expect(await option(page, 'docs').boundingBox()).toBeTruthy();
  }
  await button(page, '查看').click();
  await page.getByRole('menuitem', { name: '大图标', exact: true }).click();
  await option(page, 'docs').click();
  await page.screenshot({ path: '../../.codex-tmp/project-explorer-preview/large-icons.png' });
  await option(page, 'docs').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查看', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: '超大图标', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.codex-tmp/project-explorer-preview/context-view.png' });
  await page.getByRole('menuitem', { name: '详细信息', exact: true }).click();
  await button(page, '排序').click();
  await page.getByRole('menuitem', { name: '递减', exact: true }).click();
  await expect(page.getByRole('option').first()).toContainText('wms-biz');
  await option(page, 'README.md').click();
  await page.locator('.pe-details-toggle').click();
  await expect(page.locator('.pe-details')).toContainText('8 KB');
  await page.keyboard.press('F2');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click();
});

test('new folder, rename, copy, cut, paste and confirmed deletion', async ({ page }) => {
  await open(page, 'remote');
  await button(page, '新建').click();
  await page.getByRole('menuitem', { name: '文件夹', exact: true }).click();
  let prompt = page.getByRole('alertdialog');
  await prompt.getByRole('textbox').fill('new-folder');
  await prompt.locator('button[type="submit"]').click();
  await expect(option(page, 'new-folder')).toBeVisible();
  await option(page, 'new-folder').click();
  await button(page, '重命名').click();
  await prompt.getByRole('textbox').fill('renamed');
  await prompt.locator('button[type="submit"]').click();
  await expect(option(page, 'renamed')).toBeVisible();
  await option(page, 'README.md').click();
  await button(page, '复制').click();
  await option(page, 'docs').dblclick();
  await button(page, '粘贴').click();
  await expect(page.getByRole('option')).toContainText(['README.md']);
  await page.getByRole('option').click();
  await button(page, '剪切').click();
  await button(page, '向上一级').click();
  await option(page, 'scripts').dblclick();
  await button(page, '粘贴').click();
  await expect(page.getByRole('option')).toContainText(['README.md']);
  await page.getByRole('option').click();
  await button(page, '删除').click();
  prompt = page.getByRole('alertdialog');
  await expect(page.getByRole('option')).toHaveCount(1);
  await prompt.locator('button[type="submit"]').click();
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('touch long press exposes the same view menu without opening a folder', async ({ page }) => {
  await open(page, 'web');
  const entry = option(page, 'docs');
  const rect = (await entry.boundingBox())!;
  await entry.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: rect.x + 20, clientY: rect.y + 15 });
  await expect(page.getByRole('menuitem', { name: '查看', exact: true })).toBeVisible();
  await entry.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.getByRole('menuitem', { name: '查看', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: '超大图标', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '中等图标', exact: true }).click();
  await expect(page.locator('.pe-view-medium')).toBeVisible();
  await expect(page.locator('.pe-footer input')).toHaveValue(`${explorerRoot}/docs`);
  await expect(option(page, 'docs')).toBeVisible();
});

test('address entry, roots, failed paths and refresh recovery', async ({ page }) => {
  await open(page);
  await page.locator('.pe-address-edit').click();
  await page.getByRole('textbox', { name: '文件夹地址', exact: true }).fill('D:/missing');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('无法读取文件夹');
  await expect(button(page, '选择文件夹')).toBeDisabled();
  await button(page, '后退').click();
  await expect(option(page, 'docs')).toBeVisible();
  await page.locator('.pe-computer').click();
  await expect(button(page, '选择文件夹')).toBeDisabled();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: /D:\// }).dblclick();
  await expect(page.getByRole('option')).toContainText(['jiutian-projects']);
  await button(page, '刷新').click();
  await expect(page.getByRole('option')).toHaveCount(1);
});

test('dark appearance, compact desktop width and live language switching', async ({ page }) => {
  await open(page, 'web', '&dark=1');
  await page.screenshot({ path: '../../.codex-tmp/project-explorer-preview/dark-details.png' });
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.locator('.pe-shell').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: '../../.codex-tmp/project-explorer-preview/compact-desktop.png' });
  await page.evaluate(() => (window as unknown as { setExplorerLanguage: (value: string) => void })
    .setExplorerLanguage('en'));
  await expect(button(page, 'Select folder')).toBeVisible();
  await expect(page.locator('.pe-columns')).toContainText('Date modified');
});

test('mobile web retains the compact project choices', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/project-explorer-harness.html?mode=web');
  await button(page, '选择项目').click();
  await expect(page.locator('.chat-project-choices')).toBeVisible();
  await expect(page.locator('.project-explorer-modal')).toHaveCount(0);
});
