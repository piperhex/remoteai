import { expect, test, type Page } from '@playwright/test';
import { explorerRoot } from './project-explorer-fixture';

const trigger = (page: Page) => page.locator('button[aria-haspopup="menu"]').first();
const search = (page: Page) => page.getByRole('textbox', { name: '搜索项目', exact: true });
const selected = (page: Page) => page.getByTestId('selected-project');
const clear = (page: Page) => page.getByRole('button', { name: '不在项目中工作', exact: true });
const add = (page: Page) => page.getByRole('button', { name: '新建项目', exact: true });

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    for (const font of [14, 20]) {
      test(`${mode} ${dark ? 'dark' : 'light'} ${font}px: project list precedes folder selection`, async ({ page }) => {
        await page.setViewportSize({ width: font === 14 ? 1280 : 900, height: 800 });
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await page.goto(`/e2e/project-picker-harness.html?mode=${mode}&font=${font}${dark ? '&dark' : ''}`);
        const draft = page.getByRole('textbox', { name: '消息草稿' });
        await draft.fill('切换项目后保留草稿');
        await trigger(page).click();
        await expect(search(page)).toBeFocused();
        const options = page.getByRole('menuitemradio');
        await expect(options).toHaveCount(3);
        const current = page.getByRole('menuitemradio', { name: 'codex-switch', exact: true });
        await expect(current).toHaveAttribute('aria-checked', 'true');
        await expect(current.locator('svg.lucide-check')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { explorerCalls: object[] }).explorerCalls))
          .toEqual([]);
        const prefix = `../../.codex-tmp/project-picker-preview/${mode}-${dark ? 'dark' : 'light'}-${font}`;
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
          await expect(page.getByRole('button', { name: 'Work without a project', exact: true })).toBeVisible();
        }
      });
    }
  }
}
