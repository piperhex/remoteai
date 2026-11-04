import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: conversation context stays visible while running and follows workspace changes`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e2e/conversation-workspace-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    const worktree = page.getByRole('group', { name: '当前工作树', exact: true });
    const branch = page.getByRole('group', { name: '当前分支', exact: true });
    const project = page.getByRole('button', { name: mode === 'local' ? '选择项目文件夹：codex-switch' : '选择远程项目' });
    await expect(project).toBeVisible();
    await expect(project).toBeDisabled();
    await expect(worktree).toHaveText('主工作树');
    await expect(branch).toHaveText('feature/conversation-context');
    await page.getByRole('textbox', { name: 'Draft' }).fill('保留草稿');
    await page.screenshot({ path: `../../.codex-tmp/conversation-workspace-${mode}.png` });
    await page.getByRole('button', { name: 'Change branch', exact: true }).click();
    await expect(branch).toHaveText('feature/updated');
    await page.getByRole('button', { name: 'Finish turn', exact: true }).click();
    await expect(project).toBeEnabled();
    await expect(branch).toBeVisible();
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await expect(worktree).toHaveText('工作树：parallel-worktree-with-a-long-name');
    await worktree.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('F:/projects/worktrees/parallel-worktree-with-a-long-name');
    expect((await tooltip.boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.getByRole('textbox', { name: 'Draft' }).hover();
    await page.setViewportSize({ width: 920, height: 800 });
    await expect(worktree).toBeVisible();
    await expect(branch).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('保留草稿');
    await page.screenshot({ path: `../../.codex-tmp/conversation-workspace-${mode}-narrow.png` });
    await page.getByRole('button', { name: 'Git unavailable', exact: true }).click();
    await expect(branch).toHaveText('暂不可用');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Current branch', exact: true })).toHaveText('Unavailable');
  });

  test(`${mode}: narrow chat puts project controls in overflow and restores them without losing state`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e2e/conversation-workspace-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    const bar = page.locator('[data-project-bar]');
    const more = page.getByRole('button', { name: '更多项目选项', exact: true });
    const panel = page.getByRole('dialog', { name: '更多项目选项', exact: true });
    const worktree = page.getByRole('group', { name: '当前工作树', exact: true });
    await expect(worktree).toHaveText('主工作树');
    await expect(more).toBeHidden();
    await page.getByRole('textbox', { name: 'Draft' }).fill('保留草稿');
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Narrow chat', exact: true }).click();
    await expect(more).toBeVisible();
    await expect(worktree).toBeHidden();
    expect((await bar.boundingBox())!.height).toBeLessThan(50);
    await page.screenshot({ path: `../../.codex-tmp/project-overflow-${mode}-closed.png` });
    await more.click();
    await expect(panel).toBeVisible();
    await expect(worktree).toHaveText('工作树：parallel-worktree-with-a-long-name');
    await expect(panel.getByRole('group', { name: '当前分支', exact: true })).toHaveText('feature/conversation-context');
    await expect(panel.getByRole('button', { name: mode === 'local'
      ? '选择项目文件夹：parallel-worktree-with-a-long-name' : '选择远程项目' })).toBeDisabled();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(400);
    await expect(page.locator('.ant-popover').filter({ has: panel })).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../../.codex-tmp/project-overflow-${mode}-open.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await page.getByRole('textbox', { name: 'Draft' }).click();
    await expect(panel).toBeHidden();
    await more.click();
    await page.getByRole('button', { name: 'Widen chat', exact: true }).click();
    await expect(more).toBeHidden();
    await expect(worktree).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('保留草稿');
    await page.getByRole('button', { name: 'Narrow chat', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'More project options', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Current worktree', exact: true }))
      .toHaveText('Worktree: parallel-worktree-with-a-long-name');
  });

  test(`${mode}: project and branch pickers remain usable inside overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e2e/conversation-workspace-harness.html?mode=${mode}&draft`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Narrow chat', exact: true }).click();
    const more = page.getByRole('button', { name: '更多项目选项', exact: true });
    await more.click();
    const project = page.getByRole('button', { name: mode === 'local'
      ? '选择项目文件夹：codex-switch' : '选择远程项目' });
    await project.click();
    const search = page.getByRole('searchbox', { name: '在当前文件夹中搜索', exact: true });
    await expect(search).toBeVisible();
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(project).toBeFocused();
    const branch = page.getByRole('button', { name: '切换 Git 分支', exact: true });
    await branch.click();
    await page.getByRole('menuitemradio', { name: 'main', exact: true }).click();
    // Choosing from a nested portal may dismiss overflow, but must still complete the action.
    if (await more.getAttribute('aria-expanded') === 'false') await more.click();
    await expect(branch).toHaveText('main');
    await page.getByRole('button', { name: 'Widen chat', exact: true }).click();
    await expect(branch).toBeVisible();
    await expect(branch).toHaveText('main');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
