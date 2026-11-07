import { expect, test, type Locator, type Page } from '@playwright/test';

const projectPath = 'F:/projects/remoteai';
const toggleName = `展开项目: ${projectPath}`;

async function expectBoundedTable(page: Page, pane: Locator) {
  const body = pane.locator('.ant-table-body');
  const header = pane.locator('.ant-table-header');
  const headerTop = (await header.boundingBox())!.y;
  const before = await body.evaluate(element => ({ height: element.clientHeight, total: element.scrollHeight,
    bottom: element.getBoundingClientRect().bottom }));
  expect(before.height).toBeGreaterThan(100);
  expect(before.total).toBeGreaterThan(before.height);
  expect(before.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(pane.getByText('项目对话 64', { exact: true })).toBeInViewport();
  expect((await header.boundingBox())!.y).toBe(headerTop);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
  expect(await pane.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.setViewportSize({ ...page.viewportSize()!, height: page.viewportSize()!.height - 100 });
  await expect.poll(() => body.evaluate(element => element.clientHeight)).toBeLessThan(before.height);
  await expect(pane.getByRole('button', { name: '对话同步', exact: true })).toBeInViewport();
  await body.evaluate(element => { element.scrollTop = 0; });
}

for (const mode of ['local', 'remote']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: project groups and table scrolling at ${enlarged ? '20px narrow dark' : '14px wide light'}`,
      async ({ page }) => {
        await page.setViewportSize({ width: enlarged ? 860 : 1440, height: enlarged ? 700 : 900 });
        const suffix = `${mode === 'remote' ? '&dialog=1' : ''}${enlarged ? '&font=20&dark=1' : ''}`;
        await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&grouped=1${suffix}`);
        if (mode === 'remote') await page.getByRole('button', { name: '对话同步', exact: true }).click();
        const pane = page.getByRole('region', { name: '对话同步', exact: true });
        const project = pane.getByRole('row').filter({ has: page.getByText(projectPath, { exact: true }) });
        await expect(pane.getByRole('button', { name: /^展开项目:/ })).toHaveCount(3);
        await expect(project.getByRole('cell', { name: '65', exact: true })).toBeVisible();
        await expect(pane.getByText('排查项目中的登录问题')).toBeHidden();
        const prefix = `../../.codex-tmp/sync-table-${mode}-${enlarged ? 'font20-dark-narrow' : 'font14-light-wide'}`;
        await page.screenshot({ path: `${prefix}-collapsed.png`, animations: 'disabled' });
        await project.getByRole('checkbox').check();
        await pane.getByRole('button', { name: toggleName, exact: true }).click();
        const first = pane.getByRole('row').filter({ has: page.getByText('排查项目中的登录问题', { exact: true }) });
        await expect(first.getByRole('checkbox')).toBeChecked();
        await first.getByRole('checkbox').uncheck();
        await expect(project.getByRole('checkbox')).toBeChecked({ indeterminate: true });
        await pane.getByRole('button', { name: `折叠项目: ${projectPath}`, exact: true }).click();
        await expect(pane.getByText('排查项目中的登录问题')).toBeHidden();
        await expect(pane.getByRole('button', { name: '对话同步', exact: true })).toBeEnabled();
        await pane.getByRole('button', { name: toggleName, exact: true }).click();
        await expect(first.getByRole('checkbox')).not.toBeChecked();
        await expectBoundedTable(page, pane);
        await page.screenshot({ path: `${prefix}-expanded.png`, animations: 'disabled' });
        const selectAll = pane.locator('.ant-table-thead').getByRole('checkbox');
        await selectAll.check();
        await pane.getByRole('button', { name: '对话同步', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '确认同步对话？' })).toBeVisible();
        const ids = await page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
          request: { action: string; sessionIds?: string[] } }[])
          .find(call => ['prepare', 'export'].includes(call.request.action))?.request.sessionIds);
        expect(ids).toHaveLength(67);
        expect(ids).toEqual(expect.arrayContaining(['thread-sync', 'thread-63', 'other-project', 'no-project']));
        expect(new Set(ids).size).toBe(67);
      });
  }
}

test('search expands matching projects and source changes reset selection and expansion', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=remote&grouped=1');
  const pane = page.getByRole('region', { name: '对话同步', exact: true });
  await pane.getByPlaceholder('搜索标题和对话内容').fill('项目对话 64');
  await expect(pane.getByText('项目对话 64', { exact: true })).toBeVisible();
  await pane.getByRole('row').filter({ has: page.getByText('项目对话 64', { exact: true }) })
    .getByRole('checkbox').check();
  await pane.getByRole('button', { name: `折叠项目: ${projectPath}`, exact: true }).click();
  await expect(pane.getByText('项目对话 64', { exact: true })).toBeHidden();
  await pane.getByRole('combobox', { name: '来源目录' }).press('ArrowDown');
  await page.locator('.ant-select-item-option').filter({ hasText: 'Office PC · D:/Remote AI/.codex' }).click();
  await expect(pane.getByPlaceholder('搜索标题和对话内容')).toBeEmpty();
  await expect(pane.getByRole('button', { name: toggleName, exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: '对话同步', exact: true })).toBeDisabled();
});

test('type filtering keeps selections in other conversation types', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=local&grouped=1');
  const pane = page.getByRole('region', { name: '对话同步', exact: true });
  const project = pane.getByRole('row').filter({ has: page.getByText(projectPath, { exact: true }) });
  await project.getByRole('checkbox').check();
  await pane.getByRole('combobox', { name: '对话类型' }).press('ArrowDown');
  await page.locator('.ant-select-item-option').filter({ hasText: /^外部$/ }).click();
  await expect(project.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await project.getByRole('checkbox').uncheck();
  await pane.getByRole('button', { name: '对话同步', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认同步对话？' })).toBeVisible();
  const ids = await page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
    request: { action: string; sessionIds?: string[] } }[])
    .find(call => call.request.action === 'prepare')?.request.sessionIds);
  expect(ids).toHaveLength(64);
  expect(ids).not.toContain('thread-0');
  expect(ids).toContain('thread-sync');
});
