import { expect, test, type Page } from '@playwright/test';

const path = 'C:/project/Remote AI_2.2.13_x64_en-US.msi';
const name = path.split('/').at(-1)!;
const card = (page: Page) => page.getByRole('region', { name, exact: true });
const more = (page: Page) => card(page).getByRole('button', { name: `文件操作：${path}`, exact: true });
const action = (page: Page) => page.locator('body').getAttribute('data-action').then(value => JSON.parse(value!));
const items = (page: Page) => page.getByRole('menu').first().getByRole('menuitem').allTextContents();

async function openCard(page: Page, query = '') {
  await page.goto(`/e2e/file-preview-harness.html?browser&manual&path=${encodeURIComponent(path)}${query}`);
  await page.getByRole('button', { name: `预览文件：${path}`, exact: true }).click();
  await expect(card(page)).toBeVisible();
}

test('local file card opens directly and shares the remaining context actions across gestures', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openCard(page);
  await expect(card(page).getByRole('button', { name: '下载', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('desktop-local-light-card.png'), animations: 'disabled' });
  await card(page).getByRole('button', { name: '打开', exact: true }).click();
  await expect.poll(() => action(page)).toEqual({
    target: { path, threadId: 'fixture' }, action: { type: 'open', application: 'default' },
  });
  await more(page).click();
  await expect(page.getByRole('menuitem', { name: '在 VS Code 中打开', exact: true })).toBeVisible();
  const remaining = await items(page);
  expect(remaining).toEqual(['在 VS Code 中打开', '打开方式', '另存为…', '复制文件', '复制路径',
    '复制文件内容', '在文件管理器中显示']);
  await page.screenshot({ path: test.info().outputPath('desktop-local-light-menu.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: '在 VS Code 中打开', exact: true }).click();
  await expect.poll(() => action(page)).toMatchObject({ action: { type: 'open', application: 'vscode' } });
  await more(page).click({ button: 'right' });
  expect(await items(page)).toEqual(remaining);
  await page.keyboard.press('Escape');
  await more(page).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0 });
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  await more(page).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0 });
  expect(await items(page)).toEqual(remaining);
  await page.screenshot({ path: test.info().outputPath('desktop-local-touch-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  const link = page.getByRole('button', { name: `预览文件：${path}`, exact: true });
  await link.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '打开文件', exact: true })).toBeVisible();
  expect((await items(page)).filter(label => !['预览文件', '打开文件'].includes(label))).toEqual(remaining);
});

test('local file actions fit a narrow dark window with enlarged text and support keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 820 });
  await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
  await openCard(page, '&dark');
  await more(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '打开方式', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '打开方式', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: 'VS Code', exact: true })).toBeVisible();
  const triggerBounds = (await more(page).boundingBox())!;
  const menuBounds = (await page.getByRole('menu').first().boundingBox())!;
  expect(menuBounds.x + menuBounds.width).toBeGreaterThanOrEqual(triggerBounds.x);
  expect(menuBounds.y).toBeGreaterThan(0);
  for (const element of [card(page), ...await page.getByRole('menu').all()]) {
    const bounds = (await element.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(820);
  }
  await page.screenshot({ path: test.info().outputPath('desktop-local-dark-narrow-20px-menu.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'VS Code', exact: true }).click();
  await expect.poll(() => action(page)).toMatchObject({ action: { type: 'open', application: 'vscode' } });
});

test('desktop remote file card retains the download action', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openCard(page, '&mode=remote');
  await expect(card(page).getByRole('button', { name: '打开', exact: true })).toHaveCount(0);
  await expect(more(page)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('desktop-remote-light-download.png'), animations: 'disabled' });
  await card(page).getByRole('button', { name: '下载', exact: true }).click();
  await expect.poll(() => action(page)).toEqual({ target: { path, threadId: 'fixture' }, action: { type: 'saveAs' } });
});
