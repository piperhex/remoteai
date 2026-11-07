import { expect, type Page, type TestInfo } from '@playwright/test';
import { longPress } from './project-browser-touch';

const drawer = (page: Page) => page.locator('aside[data-details-panel]');
const tabBar = (page: Page) => drawer(page).getByRole('tablist', { name: '侧栏内容', exact: true });
const tab = (page: Page, name: string) => tabBar(page).getByRole('tab', { name, exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: '标签页操作', exact: true });
const hide = (page: Page) => drawer(page).getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
async function shot(page: Page, info: TestInfo, name: string) {
  if (await menu(page).count()) {
    await menu(page).hover();
    await expect(menu(page).locator('..')).toHaveCSS('opacity', '1');
    const bounds = (await menu(page).boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

async function openGit(page: Page, mode: string) {
  if (mode === 'web') {
    await page.getByRole('button', { name: '打开工具', exact: true }).click();
    await page.getByRole('button', { name: 'Git', exact: true }).click();
  } else await page.getByRole('button', { name: '打开 Git', exact: true }).click();
}

async function checkSingleTab(options: { page: Page; info: TestInfo; label: string }) {
  const { page, info, label } = options;
  await page.getByRole('button', { name: '侧栏内容', exact: true }).click();
  const start = tab(page, '新标签页');
  await start.click({ button: 'right' });
  await expect(menu(page).getByRole('menuitem')).toHaveText(['关闭其他标签页', '关闭右侧标签页']);
  for (const item of await menu(page).getByRole('menuitem').all()) {
    await expect(item).toHaveAttribute('aria-disabled', 'true');
  }
  await shot(page, info, `${label}-single-right-click`);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden(); await expect(start).toBeFocused();
  await longPress(page, start, '标签页操作');
  await expect(menu(page).getByRole('menuitem')).toHaveCount(2);
  await shot(page, info, `${label}-single-long-press`);
  await page.keyboard.press('Escape'); await hide(page);
}

async function openDrafts(page: Page, mode: string) {
  await page.getByRole('button', { name: '打开预览', exact: true }).click(); await hide(page);
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
  await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('保留文件草稿');
  await hide(page); await openGit(page, mode);
  await page.getByRole('textbox', { name: '提交说明', exact: true }).fill('保留 Git 草稿');
  await hide(page); await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
  await page.getByRole('textbox', { name: '验收草稿', exact: true }).fill('保留验收草稿');
  await expect(tabBar(page).getByRole('tab')).toHaveCount(4);
}

async function checkBatchClose(options: { page: Page; info: TestInfo; label: string; mode: string }) {
  const { page, info, label, mode } = options;
  await tab(page, '文件浏览').click({ button: 'right' });
  await expect(tab(page, '任务验收')).toHaveAttribute('aria-selected', 'true');
  await shot(page, info, `${label}-multiple-right-click`);
  await menu(page).getByRole('menuitem', { name: '关闭右侧标签页', exact: true }).click();
  await expect(tabBar(page).getByRole('tab')).toHaveText(['浏览器', '文件浏览']);
  await expect(tab(page, '文件浏览')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('保留文件草稿');
  await tab(page, '文件浏览').focus(); await page.keyboard.press('Shift+F10');
  await expect(menu(page).getByRole('menuitem', { name: '关闭右侧标签页', exact: true }))
    .toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape'); await expect(drawer(page)).toBeVisible();
  await hide(page); await openGit(page, mode);
  await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toHaveValue('保留 Git 草稿');
  await hide(page); await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '验收草稿', exact: true })).toHaveValue('保留验收草稿');
  await tab(page, '文件浏览').scrollIntoViewIfNeeded();
  await longPress(page, tab(page, '文件浏览'), '标签页操作');
  await expect(tab(page, '任务验收')).toHaveAttribute('aria-selected', 'true');
  await expect(menu(page).getByRole('menuitem')).toHaveText(['关闭其他标签页', '关闭右侧标签页']);
  await shot(page, info, `${label}-multiple-long-press`);
  await menu(page).getByRole('menuitem', { name: '关闭其他标签页', exact: true }).click();
  await expect(tabBar(page).getByRole('tab')).toHaveText(['文件浏览']);
  await expect(tab(page, '文件浏览')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('保留文件草稿');
  await expect(menu(page)).toBeHidden();
  await shot(page, info, `${label}-retained-file-draft`);
}

export async function checkWorkspaceTabMenu(options: {
  page: Page; info: TestInfo; label: string; mode: string; url: string;
}) {
  await options.page.goto(options.url);
  await checkSingleTab(options);
  await openDrafts(options.page, options.mode);
  await checkBatchClose(options);
}
