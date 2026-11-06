import { expect, test, type Page } from '@playwright/test';

const drawer = (page: Page) => page.locator('aside[data-details-panel]');
const tabs = (page: Page) => drawer(page).getByRole('tablist', { name: '侧栏内容', exact: true });
const switchTab = (page: Page, name: string) => tabs(page).getByRole('tab', { name, exact: true }).click();
const close = (page: Page) => drawer(page).getByRole('button', { name: '关闭详情抽屉', exact: true }).click();

for (const mode of ['local', 'web', 'remote']) {
  test(`${mode}: drawer tabs retain drafts and previews alongside a bottom terminal`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/e2e/workspace-drawer-harness.html?mode=${mode}&dark`);
    await page.getByRole('button', { name: '打开预览', exact: true }).click();
    await expect(drawer(page)).toContainText('Retained preview');
    await page.getByRole('button', { name: mode === 'local' ? '源码' : '原文', exact: true }).click();
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await drawer(page).getByRole('button', { name: '展开详情抽屉' }).click();
    await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
    await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('保留文件编辑');
    await drawer(page).getByRole('button', { name: '还原抽屉宽度' }).click();
    if (mode === 'web') {
      await page.getByRole('button', { name: '打开工具', exact: true }).click();
      await page.getByRole('button', { name: 'Git', exact: true }).click();
    } else await page.getByRole('button', { name: '打开 Git', exact: true }).click();
    await page.getByRole('textbox', { name: '提交说明' }).fill('保留 Git 草稿');
    await page.getByRole('button', { name: '查看 src/app.ts', exact: true }).click();
    await expect(drawer(page)).toContainText('new code');
    await expect(drawer(page)).toHaveCount(1);
    await switchTab(page, 'Git');
    await expect(page.getByRole('textbox', { name: '提交说明' })).toHaveValue('保留 Git 草稿');
    await page.getByRole('button', { name: '打开远程终端', exact: true }).click();
    await expect(page.locator('.xterm')).toBeVisible();
    await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
    await page.getByRole('textbox', { name: '验收草稿' }).fill('保留验收意见');
    await expect(tabs(page).getByRole('tab')).toHaveCount(5);
    await close(page);
    await expect(drawer(page)).toBeHidden();
    const reads = await page.locator('body').getAttribute('data-git-reads');
    await page.waitForTimeout(1200);
    await expect(page.locator('body')).toHaveAttribute('data-git-reads', reads!);
    await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '验收草稿' })).toHaveValue('保留验收意见');
    await expect(page.getByRole('region', { name: '终端', exact: true })).toBeVisible();
    await expect(page.locator('.xterm')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-terminal-opens', '1');
    await switchTab(page, '文件浏览');
    await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('保留文件编辑');
    await switchTab(page, '浏览器');
    await expect(drawer(page).locator('pre').filter({ hasText: 'Retained preview' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-preview-closed', 'true');
    await page.screenshot({ path: `../../.codex-tmp/workspace-drawer-${mode}.png` });
    await close(page);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await expect(tabs(page).getByRole('tab')).toHaveCount(5);
    await expect(drawer(page)).toHaveCount(1);
  });
}

test('narrow Web keeps the tab strip scrollable and the close control reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/workspace-drawer-harness.html?mode=web');
  await page.getByRole('button', { name: '打开预览', exact: true }).click();
  await close(page);
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
  await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('窄屏草稿');
  await close(page);
  await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.locator('.chat-tools-menu').getByRole('button', { name: '文件浏览', exact: true }).click();
  await expect(page.locator('[role="tabpanel"][aria-label="文件浏览"]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('窄屏草稿');
  await close(page);
  await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
  await switchTab(page, '文件浏览');
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('窄屏草稿');
  expect((await drawer(page).boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../.codex-tmp/workspace-drawer-narrow.png' });
  await close(page);
  await expect(drawer(page)).toBeHidden();
});
