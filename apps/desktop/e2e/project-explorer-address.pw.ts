import { expect, test, type Page } from '@playwright/test';
import { explorerLongPath, explorerRoot, explorerWideName } from './project-explorer-fixture';

// Initial Vite compilation is independent of the interaction assertions below.
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

const input = (page: Page) => page.getByRole('textbox', { name: '文件夹地址', exact: true });
async function open(page: Page, mode: string, dark = false) {
  await page.setViewportSize({ width: dark ? 1024 : 1600, height: dark ? 768 : 1000 });
  await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}${dark ? '&dark' : ''}`,
    { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
}
async function navigate(page: Page, path: string) {
  await page.locator('.pe-address-edit').click();
  await input(page).fill(path);
  await input(page).press('Enter');
  await expect(page.locator('.pe-footer input')).toHaveValue(path);
}
async function expectOuterFocus(page: Page) {
  await expect(input(page)).toBeFocused();
  await expect(page.locator('.pe-address')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.pe-address')).toHaveCSS('outline-width', '2px');
  await expect(input(page)).toHaveCSS('outline-style', 'none');
  await expect(input(page)).toHaveCSS('border-top-width', '0px');
  await expect(input(page)).toHaveCSS('box-shadow', 'none');
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: blank address space edits the selected full path with an outer focus ring`, async ({ page }) => {
    await open(page, mode);
    const address = page.locator('.pe-address');
    const crumbs = page.locator('.pe-address-path');
    await expect(page.locator('.pe-address-edit svg')).toHaveCount(0);
    await expect(page.locator('.pe-crumb-overflow')).toHaveCount(0);
    const height = (await address.boundingBox())!.height;
    const blank = await crumbs.boundingBox();
    await crumbs.click({ position: { x: blank!.width - 3, y: blank!.height / 2 } });
    await expectOuterFocus(page);
    expect((await address.boundingBox())!.height).toBeCloseTo(height, 0);
    await expect(input(page)).toHaveValue(explorerRoot);
    expect(await input(page).evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]))
      .toEqual([0, explorerRoot.length]);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-light-editing.png` });
    await input(page).fill('discarded draft');
    await input(page).press('Escape');
    await expect(input(page)).toHaveCount(0);
    const box = await address.boundingBox();
    await address.click({ position: { x: box!.width - 5, y: box!.height / 2 } });
    await expect(input(page)).toHaveValue(explorerRoot);
    await input(page).press('Escape');
    await crumbs.getByRole('button', { name: 'backend', exact: true }).click();
    await expect(page.locator('.pe-footer input')).toHaveValue('D:/jiutian-projects/backend');
    await expect(input(page)).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-light-breadcrumbs.png` });
  });

  test(`${mode}: long paths fold ancestors and retain a blank edit target at compact widths`, async ({ page }) => {
    await open(page, mode, true);
    await navigate(page, explorerLongPath);
    const more = page.locator('.pe-crumb-overflow button');
    await expect(more).toBeVisible();
    const current = page.locator('.pe-address-crumbs [aria-current="location"]');
    await expect(current).toHaveText('Virtual Hard Disks');
    const edit = page.locator('.pe-address-edit');
    const blank = (await edit.boundingBox())!;
    expect(blank.width).toBeGreaterThanOrEqual(32);
    const end = (await current.boundingBox())!;
    expect(end.x + end.width).toBeLessThanOrEqual(blank.x);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-dark-overflow.png` });
    await more.click();
    await expect(page.getByRole('menuitem', { name: 'C:/', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'C:/', exact: true }).click({ trial: true });
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-dark-ancestors.png`,
      animations: 'disabled' });
    await page.getByRole('menuitem', { name: 'C:/', exact: true }).click();
    await expect(page.locator('.pe-footer input')).toHaveValue('C:/');
    await expect(input(page)).toHaveCount(0);
    await navigate(page, explorerLongPath);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(more).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(more).toBeVisible();
    await edit.focus();
    await page.keyboard.press('Enter');
    await expectOuterFocus(page);
    await expect(input(page)).toHaveValue(explorerLongPath);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-dark-editing.png` });
    await input(page).press('Escape');
    await navigate(page, explorerWideName);
    expect(await page.locator('.pe-address').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await edit.boundingBox())!.width).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-address/${mode}-dark-long-name.png` });
    await edit.click();
    await expect(input(page)).toHaveValue(explorerWideName);
  });
}
