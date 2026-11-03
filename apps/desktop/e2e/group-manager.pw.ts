import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

const output = '../../.codex-tmp/group-manager';
const groups = [
  { id: 'work', name: '工作', parentId: null },
  { id: 'product', name: '产品', parentId: 'work' },
  { id: 'design', name: '设计', parentId: 'work' },
  { id: 'development', name: '开发', parentId: 'work' },
  { id: 'study', name: '学习', parentId: null },
  { id: 'english', name: '英语', parentId: 'study' },
  { id: 'ielts', name: '雅思', parentId: 'study' },
  { id: 'test', name: 'test', parentId: null },
];

async function seed(page: Page) {
  await page.addInitScript(seedGroups => {
    if (localStorage.getItem('manager-fixture')) return;
    const projects: Record<string, string> = {};
    const counts = [['product', 5], ['design', 3], ['development', 4], ['english', 6], ['ielts', 2]] as const;
    for (const [id, count] of counts) {
      for (let index = 0; index < count; index += 1) projects[`/workspace/${id}-${index}`] = id;
    }
    const grouping = { groups: seedGroups, projects, threads: {} };
    localStorage.setItem('codex-switch:gui-custom-groups', JSON.stringify(grouping));
    localStorage.setItem('manager-fixture', '1');
  }, groups);
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: reference layout, search, independent selection and safe batch deletion`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seed(page);
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}`);
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '管理分组', exact: true });
    const bounds = await dialog.locator('.ant-modal-content').boundingBox();
    expect(bounds?.width).toBeCloseTo(1440 * 0.85, 0);
    expect(bounds?.height).toBeCloseTo(1000 * 0.85, 0);
    const row = (name: string) => dialog.getByRole('row').filter({
      has: page.getByRole('checkbox', { name: `选择 ${name}`, exact: true }),
    });
    await expect(row('工作').getByRole('cell').nth(2)).toHaveText('12');
    await expect(row('学习').getByRole('cell').nth(2)).toHaveText('8');
    for (const name of ['设计', '开发', '英语']) await row(name).getByRole('checkbox').check();
    await expect(dialog.getByText('已选择 3 项')).toBeVisible();
    await expect(row('工作').getByRole('checkbox')).not.toBeChecked();
    await page.screenshot({ path: `${output}/${mode}-light-selected.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: '折叠分组：工作', exact: true }).click();
    await expect(row('设计')).toHaveCount(0);
    await dialog.getByRole('textbox', { name: '搜索分组…' }).fill('设计');
    await expect(row('设计')).toBeVisible();
    await expect(dialog.getByRole('row')).toHaveCount(3);
    await page.screenshot({ path: `${output}/${mode}-search.png`, animations: 'disabled' });
    await dialog.getByRole('textbox', { name: '搜索分组…' }).fill('no such group');
    await expect(dialog.getByText('没有找到匹配的分组')).toBeVisible();
    await dialog.getByRole('textbox', { name: '搜索分组…' }).fill('');
    await dialog.getByRole('button', { name: '展开分组：工作', exact: true }).click();
    await dialog.getByRole('button', { name: '批量删除', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '删除选中的 3 个分组？', exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('内容不会被删除');
    await confirm.getByRole('button', { name: '批量删除', exact: true }).click({ trial: true });
    await page.screenshot({ path: `${output}/${mode}-delete-confirm.png`, animations: 'disabled' });
    await confirm.getByRole('button', { name: /取\s*消/ }).click();
    await expect(row('设计')).toBeVisible();
    await dialog.getByRole('button', { name: '批量删除', exact: true }).click();
    await confirm.getByRole('button', { name: '批量删除', exact: true }).click();
    await expect(row('设计')).toHaveCount(0);
    await expect(dialog.getByText('已选择 0 项')).toBeVisible();
    await expect(row('工作').getByRole('cell').nth(2)).toHaveText('12');
    await page.reload();
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    await expect(row('设计')).toHaveCount(0);
    await dialog.getByRole('tab', { name: '项目与对话' }).click();
    await dialog.getByRole('searchbox', { name: '搜索项目或对话' }).fill('design-0');
    await expect(dialog.getByRole('row').filter({ hasText: 'design-0' })).toContainText('工作');
    await page.screenshot({ path: `${output}/${mode}-members.png`, animations: 'disabled' });
  });

  test(`${mode}: dark theme and compact desktop keep the toolbar and table usable`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await seed(page);
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}&dark`);
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '管理分组', exact: true });
    await dialog.getByRole('checkbox', { name: '选择 设计', exact: true }).check();
    await expect(dialog.getByRole('button', { name: '新增分组', exact: true })).toBeInViewport();
    await dialog.getByRole('checkbox', { name: '选择当前结果', exact: true }).first().check();
    await expect(dialog.getByText('已选择 8 项')).toBeVisible();
    await dialog.getByRole('checkbox', { name: '选择当前结果', exact: true }).last().uncheck();
    await expect(dialog.getByText('已选择 0 项')).toBeVisible();
    await dialog.getByRole('checkbox', { name: '选择 设计', exact: true }).check();
    await page.screenshot({ path: `${output}/${mode}-dark-compact.png`, animations: 'disabled' });
    const overflow = await dialog.locator('.ant-modal-content')
      .evaluate(element => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    const last = dialog.getByRole('row').filter({
      has: page.getByRole('checkbox', { name: '选择 test', exact: true }),
    });
    await last.getByRole('button', { name: '编辑分组', exact: true }).scrollIntoViewIfNeeded();
    await expect(last.getByRole('button', { name: '删除分组', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('columnheader', { name: '分组名称', exact: true })).toBeInViewport();
    await page.screenshot({ path: `${output}/${mode}-dark-scrolled.png`, animations: 'disabled' });
  });
}

test('custom theme color is inherited by the manager', async ({ page }) => {
  await page.goto('/e2e/custom-groups-harness.html?color=%238b5cf6');
  await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
  const manager = page.locator('.chat-group-manager-desktop');
  await expect(manager.getByRole('button', { name: '新增分组', exact: true }))
    .toHaveCSS('background-color', 'rgb(139, 92, 246)');
  await expect(manager.locator('.chat-group-table-name > svg').first()).toHaveCSS('color', 'rgb(139, 92, 246)');
  await page.screenshot({ path: `${output}/local-custom-theme.png`, animations: 'disabled' });
});
