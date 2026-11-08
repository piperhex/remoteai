import { expect, test, type Locator, type Page } from '@playwright/test';
import { explorerRoot } from './project-explorer-fixture';
import { testText } from '../../../scripts/i18n-fixture.mjs';

const trigger = (page: Page) => page.locator('button[aria-haspopup="menu"]').first();
const search = (page: Page) => page.getByRole('textbox', { name: '搜索项目', exact: true });
const selected = (page: Page) => page.getByTestId('selected-project');
const clear = (page: Page) => page.locator('.ant-popover').getByRole('button', {
  name: testText('client.projectPicker.workWithoutProject'), exact: true,
});
const quickClear = (page: Page) => page.getByRole('button', {
  name: testText('client.conversation.clearProjectSelection'), exact: true,
});
const add = (page: Page) => page.getByRole('button', { name: '新建项目', exact: true });

async function verifyQuickClear({ page, draft, prefix }: { page: Page; draft: Locator; prefix: string }) {
  await page.mouse.move(0, 0);
  await expect(quickClear(page).locator('svg.lucide-folder')).toBeVisible();
  await expect(quickClear(page).locator('svg.lucide-x')).toBeHidden();
  await page.screenshot({ path: `${prefix}-idle.png` });
  await trigger(page).hover();
  await expect(quickClear(page).locator('svg.lucide-folder')).toBeHidden();
  await expect(quickClear(page).locator('svg.lucide-x')).toBeVisible();
  await page.screenshot({ path: `${prefix}-hover.png` });
  await quickClear(page).click();
  await expect(selected(page)).toHaveText('');
  await expect(trigger(page)).toHaveText('选择项目');
  await expect(search(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(draft).toHaveValue('切换项目后保留草稿');
  await page.screenshot({ path: `${prefix}-cleared.png` });
  await trigger(page).click();
  await page.getByRole('menuitemradio', { name: 'codex-switch', exact: true }).click();
  await page.keyboard.press('Shift+Tab');
  await expect(quickClear(page)).toBeFocused();
  await expect(quickClear(page).locator('svg.lucide-x')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(selected(page)).toHaveText('');
  await expect(trigger(page)).toBeFocused();
  await trigger(page).click();
  await page.getByRole('menuitemradio', { name: 'codex-switch', exact: true }).click();
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: disabled project cannot be cleared`, async ({ page }) => {
    await page.goto(`/e2e/project-picker-harness.html?mode=${mode}&disabled`);
    await expect(quickClear(page)).toBeDisabled();
    await expect(trigger(page)).toBeDisabled();
    await quickClear(page).hover();
    await expect(quickClear(page).locator('svg.lucide-folder')).toBeVisible();
    await expect(quickClear(page).locator('svg.lucide-x')).toBeHidden();
    await quickClear(page).evaluate(button => (button as HTMLButtonElement).click());
    await expect(selected(page)).toHaveText(explorerRoot);
    await expect(search(page)).toBeHidden();
  });
  for (const dark of [false, true]) {
    for (const font of [14, 20]) {
      test(`${mode} ${dark ? 'dark' : 'light'} ${font}px: project list precedes folder selection`, async ({ page }) => {
        await page.setViewportSize({ width: font === 14 ? 1280 : 900, height: 800 });
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await page.goto(`/e2e/project-picker-harness.html?mode=${mode}&font=${font}${dark ? '&dark' : ''}`);
        const draft = page.getByRole('textbox', { name: '消息草稿' });
        await draft.fill('切换项目后保留草稿');
        const prefix = `../../.codex-tmp/project-picker-preview/${mode}-${dark ? 'dark' : 'light'}-${font}`;
        await verifyQuickClear({ page, draft, prefix });
        const beforeOpen = await page.evaluate(() =>
          [...(window as unknown as { explorerCalls: object[] }).explorerCalls]);
        await trigger(page).click();
        await expect(search(page)).toBeFocused();
        const options = page.getByRole('menuitemradio');
        await expect(options).toHaveCount(3);
        const current = page.getByRole('menuitemradio', { name: 'codex-switch', exact: true });
        await expect(current).toHaveAttribute('aria-checked', 'true');
        await expect(current.locator('svg.lucide-check')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { explorerCalls: object[] }).explorerCalls))
          .toEqual(beforeOpen);
        await add(page).hover();
        await page.screenshot({ path: `${prefix}-list.png` });
        const panel = page.locator('.ant-popover-inner');
        expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        const bodySize = await draft.evaluate(node => getComputedStyle(node).fontSize);
        await expect(current).toHaveCSS('font-size', bodySize);
        if (font === 14) expect(bodySize).toBe(mode === 'web' ? '14px' : '12px');
        else expect(Number.parseFloat(bodySize)).toBeGreaterThan(14);
        await search(page).fill('没有匹配的项目');
        await expect(page.getByText('没有找到匹配的项目', { exact: true })).toBeVisible();
        await expect(add(page)).toBeEnabled();
        await search(page).fill('MAIL');
        await expect(options).toHaveCount(1);
        await search(page).press('ArrowDown');
        await expect(options.first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(selected(page)).toHaveText(`${explorerRoot}/docs`);
        await expect(trigger(page)).toBeFocused();
        await expect(draft).toHaveValue('切换项目后保留草稿');
        await trigger(page).click();
        await clear(page).click();
        await expect(selected(page)).toHaveText('');
        await trigger(page).click();
        await expect(search(page)).toHaveValue('');
        await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(0);
        await search(page).press('Escape');
        await expect(trigger(page)).toBeFocused();
        await trigger(page).click();
        await page.getByRole('menuitemradio', { name: 'codex-switch', exact: true }).click();
        await trigger(page).click();
        await add(page).click();
        await expect(page.locator('.project-explorer-modal')).toBeVisible();
        await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
        await page.screenshot({ path: `${prefix}-new-project.png` });
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await expect(selected(page)).toHaveText(explorerRoot);
        await expect(trigger(page)).toBeFocused();
        await expect(draft).toHaveValue('切换项目后保留草稿');
        if (!dark && font === 14) {
          await page.context().setOffline(true);
          await page.evaluate(() => (window as unknown as { setExplorerLanguage: (locale: string) => void })
            .setExplorerLanguage('en'));
          await trigger(page).click();
          await expect(page.locator('.ant-popover').getByRole('button', {
            name: testText('client.projectPicker.workWithoutProject', {}, 'en'), exact: true,
          })).toBeVisible();
        }
      });
    }
  }
}
