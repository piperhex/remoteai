import { expect, test, type Page } from '@playwright/test';

const drawer = (page: Page) => page.locator('aside[data-details-panel]');
const tabs = (page: Page) => drawer(page).getByRole('tablist', { name: '侧栏内容', exact: true });
const closeTab = (page: Page, name: string) => tabs(page).getByRole('button', { name: `关闭${name}`, exact: true }).click();

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: close drawer tabs independently, restore drafts and hide the last tab`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.addInitScript(() => localStorage.setItem('codex-switch.project-browser.auto-save', '0'));
    await page.goto(`/e2e/workspace-drawer-harness.html?mode=${mode}${mode === 'remote' ? '&dark' : ''}`);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
    await editor.fill('保留未保存的文件内容');
    await closeTab(page, '文件浏览');
    await expect(tabs(page).getByRole('tab', { name: '文件更改', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer(page)).toContainText('暂无文件更改');
    await expect(tabs(page).getByRole('tab', { name: '文件浏览', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await expect(editor).toContainText('保留未保存的文件内容');
    await expect(page.locator('.pf-status:visible')).toContainText('未保存');
    await page.getByRole('button', { name: '打开预览', exact: true }).click();
    await closeTab(page, '文件更改');
    await expect(tabs(page).getByRole('tab', { name: '浏览器', exact: true })).toHaveAttribute('aria-selected', 'true');
    await closeTab(page, '浏览器');
    await expect(tabs(page).getByRole('tab', { name: '文件浏览', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
    await page.getByRole('textbox', { name: '验收草稿' }).fill('保留验收意见');
    await closeTab(page, '任务验收');
    await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '验收草稿' })).toHaveValue('保留验收意见');
    await page.screenshot({ path: info.outputPath(`drawer-tabs-${mode}.png`) });
    await closeTab(page, '文件浏览');
    await closeTab(page, '任务验收');
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole('button', { name: '打开任务验收', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await expect(tabs(page).getByRole('tab')).toHaveCount(1);
    await expect(editor).toContainText('保留未保存的文件内容');
    await page.getByRole('button', { name: '查看文件更改', exact: true }).click();
    await expect(tabs(page).getByRole('tab', { name: '文件更改', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
}

test('narrow drawer keeps each tab close button reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/workspace-drawer-harness.html?mode=web');
  await page.getByRole('button', { name: '打开预览', exact: true }).click();
  await drawer(page).getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
  await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
  await closeTab(page, '文件更改');
  await closeTab(page, '浏览器');
  await expect(tabs(page).getByRole('tab', { name: '任务验收', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('drawer-tabs-narrow.png') });
  await closeTab(page, '任务验收');
  await expect(drawer(page)).toBeHidden();
});
