import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: ordinary sources match GUI project grouping at font ${enlarged ? 20 : 14}`,
      async ({ page }) => {
        await page.setViewportSize({ width: enlarged ? 860 : 1440, height: enlarged ? 700 : 900 });
        const variant = enlarged ? 'font20-dark-narrow' : 'font14-light-wide';
        await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&externalProjects=1&guiPath=1${
          mode === 'remote' ? '&dialog=1' : ''}${enlarged ? '&font=20&dark=1' : ''}`);
        if (mode === 'remote') {
          await page.getByRole('button', { name: '对话同步', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: '对话同步', exact: true });
          await dialog.evaluate(async element => {
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            await Promise.all(element.getAnimations().map(animation => animation.finished));
          });
        }
        const pane = page.getByRole('region', { name: '对话同步', exact: true });
        const sources = pane.getByRole('combobox', { name: '来源目录' });
        await sources.press('ArrowDown');
        const options = page.locator('.ant-select-item-option');
        await expect(options.first()).toContainText('CodexGUI');
        const labels = await options.allTextContents();
        const guiCount = mode === 'local' ? 1 : 2;
        expect(labels.slice(0, guiCount).every(label => label.endsWith('CodexGUI'))).toBe(true);
        expect(labels.slice(guiCount).every(label => !label.endsWith('CodexGUI'))).toBe(true);
        const brand = options.first().locator('span').filter({ hasText: /^CodexGUI$/ });
        await expect(brand).toHaveCSS('background-image', /linear-gradient/);
        await expect(brand).toHaveCSS('background-clip', 'text');
        await expect.poll(() => sources.evaluate(element => {
          const select = element.closest('.ant-select')!.getBoundingClientRect();
          const popup = document.querySelector('.ant-select-dropdown')!.getBoundingClientRect();
          return Math.abs(select.x - popup.x) + Math.abs(select.width - popup.width);
        })).toBeLessThan(2);
        await page.screenshot({ path: `../../.codex-tmp/sync-project-sources-${mode}-${variant}.png`,
          animations: 'disabled' });
        await sources.fill(mode === 'local' ? 'C:/Users/demo' : 'D:/work');
        const ordinary = page.locator('.ant-select-item-option').filter({ hasText: mode === 'local'
          ? 'My PC · C:/Users/demo/.codex' : 'Office PC · D:/work/.codex' });
        await expect(ordinary).toBeVisible();
        await ordinary.click();
        await expect(pane.getByText('普通 Codex 中的临时对话', { exact: true })).toBeVisible();
        await expect(pane.getByText('已移出项目的对话', { exact: true })).toBeVisible();
        const recent = pane.getByRole('row').filter({ has: page.getByText('最近', { exact: true }) });
        await expect(recent.getByRole('cell', { name: '2', exact: true })).toBeVisible();
        const project = pane.getByRole('row').filter({ has: page.getByText('客户门户', { exact: true }) });
        await expect(project.getByRole('cell', { name: '2', exact: true })).toBeVisible();
        await expect(project).toContainText('D:\\clients\\portal');
        await project.getByRole('button').click();
        await expect(pane.getByText('检查客户登录流程', { exact: true })).toBeVisible();
        await expect(pane.getByText('完善客户设置页面', { exact: true })).toBeVisible();
        await expect(pane.getByText('codex-switch', { exact: true })).toBeVisible();
        await expect(pane.getByText(/Documents\\Codex|old-project|\\\\\?\\/)).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `../../.codex-tmp/sync-projects-${mode}-${variant}.png`,
          animations: 'disabled' });
      });
  }
}
