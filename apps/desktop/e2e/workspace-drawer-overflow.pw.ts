import { expect, test, type Locator, type Page } from '@playwright/test';

const drawer = (page: Page) => page.locator('aside[data-details-panel]');
const closeDrawer = (page: Page) => drawer(page).getByRole('button', { name: '关闭详情抽屉', exact: true }).click();

async function openTabs(page: Page, { mode, withGit }: { mode: string; withGit: boolean }) {
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await page.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
  await closeDrawer(page);
  await page.getByRole('button', { name: '打开预览', exact: true }).click();
  await closeDrawer(page);
  // Mobile Git has its own bottom sheet instead of a workspace tab.
  if (withGit) {
    if (mode === 'web') {
      await page.getByRole('button', { name: '打开工具', exact: true }).click();
      await page.getByRole('button', { name: 'Git', exact: true }).click();
    } else await page.getByRole('button', { name: '打开 Git', exact: true }).click();
    await closeDrawer(page);
  }
  await page.getByRole('button', { name: '打开任务验收', exact: true }).click();
}

async function expectSelectedVisible(strip: Locator) {
  await expect.poll(() => strip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const active = element.querySelector('[data-active=true]')!.getBoundingClientRect();
    return active.left >= bounds.left - 1 && active.right <= bounds.right + 1;
  })).toBe(true);
}

async function clippedNames(strip: Locator) {
  return strip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('[data-overflow-tab]')].filter(tab => {
      const rect = tab.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
    }).map(tab => tab.querySelector('[role=tab] span')!.textContent ?? '');
  });
}

for (const [mode, width] of [['local', 900], ['remote', 900], ['web', 900], ['web', 390]] as const) {
  test(`${mode} ${width}: drawer overflow reveals, selects and closes hidden tabs`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/e2e/workspace-drawer-harness.html?mode=${mode}&changes${mode === 'remote' ? '&dark' : ''}`);
    const tabCount = width === 390 ? 4 : 5;
    await openTabs(page, { mode, withGit: tabCount === 5 });
    const bar = drawer(page).locator('.workspace-drawer-tabs-bar');
    const strip = bar.getByRole('tablist', { name: '侧栏内容', exact: true });
    const more = bar.getByRole('button', { name: '更多标签页', exact: true });
    await expect(strip.getByRole('tab')).toHaveCount(tabCount);
    await expect(more).toBeVisible();
    await expectSelectedVisible(strip);
    await expect(bar).toHaveAttribute('data-clipped-left', 'true');
    await expect(strip).toHaveCSS('mask-image', /linear-gradient/);
    await expect(strip.locator('[data-active=true]')).toHaveCSS('border-radius', '6px');
    const hidden = await clippedNames(strip);
    expect(hidden).toContain('文件更改');
    expect(hidden).not.toContain('任务验收');
    await more.click();
    const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.locator('.workspace-drawer-tabs-menu-item > span')).toHaveText(hidden);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(Math.min(400, width));
    await expect.poll(async () => {
      const bounds = (await menu.boundingBox())!;
      return bounds.x >= 0 && bounds.x + bounds.width <= width;
    }).toBe(true);
    await page.screenshot({ path: info.outputPath('drawer-overflow.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(drawer(page)).toBeVisible();
    await expect(more).toBeFocused();
    await more.click();
    await menu.getByText('文件更改', { exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(strip.getByRole('tab', { name: '文件更改', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expectSelectedVisible(strip);
    await expect(bar).toHaveAttribute('data-clipped-left', 'false');
    await page.keyboard.press('End');
    await expect(strip.getByRole('tab', { name: '任务验收', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expectSelectedVisible(strip);
    await more.click();
    await menu.getByRole('button', { name: '关闭文件更改', exact: true }).click();
    await expect(strip.getByRole('tab')).toHaveCount(tabCount - 1);
    await expect(strip.getByRole('tab', { name: '任务验收', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expectSelectedVisible(strip);
    await page.setViewportSize({ width: 1600, height: 900 });
    await drawer(page).getByRole('button', { name: '展开详情抽屉', exact: true }).click();
    await expect(more).toHaveCount(0);
    await expect(bar).toHaveAttribute('data-clipped-left', 'false');
    await expect(strip).toHaveCSS('mask-image', 'none');
    await expectSelectedVisible(strip);
    await strip.getByRole('tab', { name: '文件浏览', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('drawer-expanded.png'), animations: 'disabled' });
  });
}
