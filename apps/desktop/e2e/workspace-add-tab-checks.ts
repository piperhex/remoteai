import { expect, type Page, type TestInfo } from '@playwright/test';

const drawer = (page: Page) => page.locator('aside[data-details-panel]');
const bar = (page: Page) => drawer(page).locator('.workspace-drawer-tabs-bar');
const add = (page: Page) => bar(page).getByRole('button', { name: '＋ 新增', exact: true });
const more = (page: Page) => bar(page).getByRole('button', { name: '更多标签页', exact: true });
const tab = (page: Page, name: string) => bar(page).getByRole('tab', { name, exact: true });
const addition = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });
const addEntry = (page: Page) => page.getByRole('menuitem', { name: /^＋ 新增/ });

async function openAdd(page: Page) {
  if (await more(page).isVisible()) {
    await more(page).click();
    const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
    const first = menu.locator(':scope > li').first();
    await expect(first.getByRole('menuitem')).toHaveText('＋ 新增');
    await first.getByRole('menuitem').click();
    await expect(page.locator('.workspace-drawer-add-submenu:visible')).toBeVisible();
  } else await add(page).click();
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.workspace-drawer-tabs-menu:visible')).toBeVisible();
  const submenu = page.locator('.workspace-drawer-add-submenu:visible');
  await (await submenu.isVisible() ? submenu : page.locator('.workspace-drawer-tabs-menu:visible')).hover();
  for (const menu of await page.locator('.workspace-drawer-tabs-menu:visible, .workspace-drawer-add-submenu:visible').all()) {
    await expect(menu).toHaveCSS('opacity', '1');
    await expect(menu).toHaveCSS('transform', 'none');
    const bounds = (await menu.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

async function checkDirectMenu(page: Page, info: TestInfo, label: string) {
  await page.getByRole('button', { name: '查看文件更改', exact: true }).click();
  await expect(tab(page, '文件更改')).toHaveAttribute('aria-selected', 'true');
  await expect(add(page)).toBeVisible();
  await expect.poll(() => bar(page).evaluate(element => {
    const tabs = element.querySelectorAll('[data-overflow-tab]');
    const lastTab = tabs[tabs.length - 1].getBoundingClientRect();
    const button = element.querySelector('.workspace-drawer-tabs-add')!.getBoundingClientRect();
    return button.left - lastTab.right;
  })).toBeCloseTo(2);
  await add(page).click();
  const menu = page.getByRole('menu', { name: '＋ 新增', exact: true });
  await expect(menu.getByRole('menuitem')).toHaveText(['浏览器', 'Git', '文件浏览']);
  await screenshot(page, info, `${label}-add-menu`);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(add(page)).toBeFocused();
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await addition(page, '文件浏览').click();
  await expect(tab(page, '文件浏览')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
  await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('新增菜单保留草稿');
  await openAdd(page); await addition(page, 'Git').click();
  await expect(tab(page, 'Git')).toHaveAttribute('aria-selected', 'true');
  await openAdd(page); await addition(page, '浏览器').click();
  await expect(tab(page, '浏览器')).toHaveAttribute('aria-selected', 'true');
  await expect(drawer(page).getByRole('textbox', { name: '页面地址', exact: true })).toBeVisible();
  await expect(add(page)).toHaveCount(0);
}

async function checkOverflowMenu(page: Page, info: TestInfo, label: string) {
  await drawer(page).getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
  await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
  await expect(more(page)).toBeVisible(); await expect(add(page)).toHaveCount(0);
  await more(page).click();
  await expect(addEntry(page)).toHaveCount(0);
  await screenshot(page, info, `${label}-no-available-tabs`);
  await page.keyboard.press('Escape');
  await drawer(page).getByRole('separator', { name: '调整详情抽屉宽度', exact: true }).focus();
  await page.keyboard.press('Home');
  await tab(page, '文件浏览').scrollIntoViewIfNeeded();
  await bar(page).getByRole('button', { name: '关闭文件浏览', exact: true }).click();
  await openAdd(page);
  const submenu = page.locator('.workspace-drawer-add-submenu:visible');
  await expect(submenu.getByRole('menuitem')).toHaveText(['文件浏览']);
  await screenshot(page, info, `${label}-overflow-submenu`);
  await page.keyboard.press('Escape');
  await expect(submenu).toBeHidden();
  const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
  await expect(menu).toBeVisible();
  await expect(addEntry(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(submenu).toBeVisible();
  await submenu.getByRole('menuitem', { name: '文件浏览', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(tab(page, '文件浏览')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('新增菜单保留草稿');
  await expect(bar(page).getByRole('tab')).toHaveCount(5);
  await drawer(page).getByRole('button', { name: '展开详情抽屉', exact: true }).click();
  await expect(more(page)).toHaveCount(0); await expect(add(page)).toHaveCount(0);
  await bar(page).getByRole('button', { name: '关闭浏览器', exact: true }).click();
  await expect(add(page)).toBeVisible();
  await add(page).click(); await screenshot(page, info, `${label}-expanded-add-menu`);
  await page.keyboard.press('Escape');
}

export async function checkWorkspaceAddTab(options: { page: Page; info: TestInfo; label: string; url: string }) {
  const { page, info, label, url } = options;
  await page.goto(url);
  await checkDirectMenu(page, info, label);
  await checkOverflowMenu(page, info, label);
}
