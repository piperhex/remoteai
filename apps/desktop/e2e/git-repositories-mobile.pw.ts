import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const enlarged of [false, true]) {
  test(`mobile web repositories: ${enlarged ? 'enlarged' : 'default'}`, async ({ page }, info) => {
    await page.goto('/e2e/workspace-drawer-harness.html?mode=web&submodules'
      + (enlarged ? '&font=20&dark' : ''));
    await page.getByRole('button', { name: '打开工具', exact: true }).click();
    await page.getByRole('button', { name: 'Git', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Git', exact: true });
    const child = drawer.getByRole('checkbox', { name: '选择 packages/shared/src/app.ts', exact: true });
    await expect(child).toBeVisible();
    await expect(drawer.getByRole('checkbox', { name: '选择 apps/native', exact: true })).toHaveCount(0);
    await child.check();
    await drawer.getByRole('checkbox', { name: '选择 src/app.ts', exact: true }).check();
    await drawer.getByRole('textbox', { name: '提交说明', exact: true }).fill('feat: mobile repositories');
    await page.screenshot({ path: info.outputPath('mobile-web-tree.png') });
    const file = drawer.getByRole('button', { name: '查看 packages/shared/src/app.ts', exact: true });
    await file.scrollIntoViewIfNeeded();
    const box = (await file.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: box.x + 60, y: box.y + box.height / 2 }] });
    await expect(page.getByRole('menu')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    await drawer.getByRole('textbox', { name: '提交说明', exact: true }).click();
    await file.click();
    await expect(page.locator('body')).toHaveAttribute('data-git-diff-cwd', 'C:/project/packages/shared');
    await drawer.getByRole('button', { name: 'packages/shared/src/app.ts', exact: true }).click();
    await drawer.getByRole('tab', { name: '提交记录', exact: true }).click();
    const repository = drawer.getByRole('combobox', { name: 'Git 仓库', exact: true });
    await repository.selectOption('C:/project/packages/shared');
    await expect(drawer.locator('.git-history .git-refs').filter({ hasText: 'packages/shared' }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('mobile-web-child-history.png') });
    await drawer.locator('.git-history-row').first().click();
    await expect(page.locator('body')).toHaveAttribute('data-git-files-cwd', 'C:/project/packages/shared');
    await drawer.getByRole('button', { name: '返回提交记录', exact: true }).click();
    await repository.selectOption('C:/project');
    await expect(drawer.locator('.git-history .git-refs').filter({ hasText: 'packages/shared' })).toHaveCount(0);
    await drawer.getByRole('tab', { name: /^改动/ }).click();
    await drawer.getByRole('button', { name: '提交并推送', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-git-submissions', JSON.stringify([
      { operation: 'commit', cwd: 'C:/project/packages/shared' },
      { operation: 'push', cwd: 'C:/project/packages/shared' },
      { operation: 'commit', cwd: 'C:/project' },
      { operation: 'push', cwd: 'C:/project' },
    ]));
    await expect(child).toHaveCount(0);
    await drawer.getByRole('checkbox', { name: '全选', exact: true }).check();
    await drawer.getByRole('textbox', { name: '提交说明', exact: true }).fill('docs: remaining changes');
    await drawer.getByRole('button', { name: '提交 2 个文件', exact: true }).click();
    await expect(drawer.getByRole('treeitem')).toHaveCount(0);
    await expect(drawer).toContainText('工作区没有未提交的改动。');
    await page.screenshot({ path: info.outputPath('mobile-web-clean.png') });
  });
}
