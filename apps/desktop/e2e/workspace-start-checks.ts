import { expect, type Page, type TestInfo } from '@playwright/test';

export async function checkWorkspaceStart(options: {
  page: Page; info: TestInfo; url: string; label: string;
}) {
  const { page, info, url, label } = options;
  const openStart = async () => {
    await page.goto(url);
    await page.getByRole('button', { name: '侧栏内容', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新标签页', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('tab')).toHaveCount(1);
    await expect(drawer.getByRole('navigation').getByRole('button')).toHaveText(['浏览器', 'Git', '文件浏览']);
    return drawer;
  };
  let start = await openStart();
  await expect(page.locator('body')).not.toHaveAttribute('data-git-reads');
  await page.screenshot({ path: info.outputPath(`${label}-start.png`), animations: 'disabled' });
  await start.getByRole('button', { name: '浏览器', exact: true }).click();
  const drawer = page.locator('aside[data-details-panel]');
  await expect(drawer.getByRole('tab', { name: '浏览器', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('textbox', { name: '页面地址', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${label}-browser.png`), animations: 'disabled' });
  await drawer.getByRole('button', { name: '关闭文件更改', exact: true }).click();
  await drawer.getByRole('button', { name: '关闭浏览器', exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '侧栏内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新标签页', exact: true })).toBeVisible();
  start = await openStart();
  await start.getByRole('button', { name: 'Git', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'Git', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.locator('.chat-git')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${label}-git.png`), animations: 'disabled' });
  start = await openStart();
  await start.getByRole('button', { name: '文件浏览', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: '文件浏览', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('treeitem', { name: 'notes.txt', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${label}-files.png`), animations: 'disabled' });
}
