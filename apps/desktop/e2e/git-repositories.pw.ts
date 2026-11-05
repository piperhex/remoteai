import { expect, test, type Page } from '@playwright/test';

async function checkTreeMenus(page: Page) {
  const file = page.getByRole('button', { name: '查看 packages/shared/src/app.ts', exact: true });
  for (const gesture of ['right-click', 'touch']) {
    if (gesture === 'right-click') await file.click({ button: 'right' });
    else {
      const box = (await file.boundingBox())!;
      await file.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, isPrimary: true,
        clientX: box.x + 20, clientY: box.y + 10 });
    }
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    await expect(page.getByRole('menuitem', { name: '提交单个文件', exact: true })).toBeEnabled();
    await file.dispatchEvent('pointerup', { pointerType: 'touch', button: 0, isPrimary: true });
    await page.getByRole('textbox', { name: '提交说明', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  }
}

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: unified tree selection and ${enlarged ? 'enlarged narrow' : 'default'} layout`, async ({ page }, info) => {
      await page.setViewportSize({ width: enlarged ? 940 : 1440, height: 960 });
      await page.goto(`/e2e/workspace-drawer-harness.html?mode=${mode}&submodules`
        + (enlarged ? '&font=20&dark' : ''));
      if (mode === 'web') {
        await page.getByRole('button', { name: '打开工具', exact: true }).click();
        await page.getByRole('button', { name: 'Git', exact: true }).click();
      } else await page.getByRole('button', { name: '打开 Git', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Git 仓库', exact: true })).toHaveCount(0);
      const tree = page.getByRole('tree', { name: 'Git 仓库', exact: true });
      const childFile = page.getByRole('checkbox', { name: '选择 packages/shared/src/app.ts', exact: true });
      await expect(childFile).toBeVisible();
      await expect(tree.getByRole('checkbox', { name: '选择 apps/native', exact: true })).toHaveCount(0);
      await expect(tree.getByRole('checkbox', { name: '选择 apps', exact: true })).toHaveCount(0);
      if (enlarged) await page.getByRole('separator', { name: '调整详情抽屉宽度' }).press('Home');
      if (!enlarged) await checkTreeMenus(page);
      await childFile.check();
      await page.getByRole('checkbox', { name: '选择 src/app.ts', exact: true }).check();
      await page.getByRole('textbox', { name: '提交说明', exact: true }).fill('feat: update project and shared module');
      await tree.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`${mode}-unified-tree.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '查看 packages/shared/src/app.ts', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-git-diff-cwd', 'C:/project/packages/shared');
      await page.getByRole('tab', { name: 'Git', exact: true }).click();
      await page.getByRole('tab', { name: '提交记录', exact: true }).click();
      const repository = page.getByRole('combobox', { name: 'Git 仓库', exact: true });
      await expect(repository).toHaveValue('C:/project');
      await expect(repository.locator('option[value="C:/project/apps/native"]')).toHaveJSProperty('disabled', true);
      await expect(page.locator('.git-history-row')).not.toHaveCount(0);
      await expect(page.locator('.git-history .git-refs').filter({ hasText: 'packages/shared' })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${mode}-history-root.png`), animations: 'disabled' });
      await repository.selectOption('C:/project/packages/shared');
      await expect(page.locator('.git-history .git-refs').filter({ hasText: 'packages/shared' }).first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-history-child.png`), animations: 'disabled' });
      await page.locator('.git-history-row').filter({ hasText: 'packages/shared' }).first().click();
      await expect(page.locator('body')).toHaveAttribute('data-git-files-cwd', 'C:/project/packages/shared');
      await page.getByRole('button', { name: '返回提交记录', exact: true }).click();
      await expect(repository).toHaveValue('C:/project/packages/shared');
      await page.getByRole('button', { name: '刷新 Git', exact: true }).click();
      await expect(repository).toHaveValue('C:/project/packages/shared');
      await repository.selectOption('C:/project');
      await expect(page.locator('.git-history .git-refs').filter({ hasText: 'packages/shared' })).toHaveCount(0);
      await page.getByRole('tab', { name: /^改动/ }).click();
      await expect(repository).toHaveCount(0);
      await page.getByRole('button', { name: '提交并推送', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-git-submissions', JSON.stringify([
        { operation: 'commit', cwd: 'C:/project/packages/shared' },
        { operation: 'push', cwd: 'C:/project/packages/shared' },
        { operation: 'commit', cwd: 'C:/project' },
        { operation: 'push', cwd: 'C:/project' },
      ]));
      await expect(childFile).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: '选择 src/app.ts', exact: true })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: '选择 packages/shared/README.md', exact: true })).toBeVisible();
      await page.getByRole('checkbox', { name: '全选', exact: true }).check();
      await page.getByRole('textbox', { name: '提交说明', exact: true }).fill('docs: update readme files');
      await page.getByRole('button', { name: /^提交 2 个文件$/ }).click();
      await expect(tree.getByRole('treeitem')).toHaveCount(0);
      await expect(tree).toContainText('工作区没有未提交的改动。');
      await page.screenshot({ path: info.outputPath(`${mode}-clean-workspace.png`), animations: 'disabled' });
      await page.getByRole('tab', { name: '提交记录', exact: true }).click();
      await expect(repository.locator('option[value="C:/project/packages/shared"]')).toHaveCount(1);
    });
  }
}

test('a child push failure leaves the parent uncommitted and shows the completed child commit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/e2e/workspace-drawer-harness.html?mode=local&submodules&failChildPush');
  await page.getByRole('button', { name: '打开 Git', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 packages/shared/src/app.ts', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 src/app.ts', exact: true }).check();
  await page.getByRole('textbox', { name: '提交说明', exact: true }).fill('feat: update selected files');
  await page.getByRole('button', { name: '提交并推送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已提交');
  await expect(page.getByRole('alert')).toContainText('推送未完成');
  await expect(page.locator('body')).toHaveAttribute('data-git-submissions', JSON.stringify([
    { operation: 'commit', cwd: 'C:/project/packages/shared' },
  ]));
  await expect(page.getByRole('checkbox', { name: '选择 src/app.ts', exact: true })).toBeChecked();
  await page.evaluate(() => history.replaceState(null, '', location.href.replace('&failChildPush', '')));
  await page.getByRole('button', { name: '提交并推送', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-git-submissions', JSON.stringify([
    { operation: 'commit', cwd: 'C:/project/packages/shared' },
    { operation: 'push', cwd: 'C:/project/packages/shared' },
    { operation: 'commit', cwd: 'C:/project' },
    { operation: 'push', cwd: 'C:/project' },
  ]));
});
