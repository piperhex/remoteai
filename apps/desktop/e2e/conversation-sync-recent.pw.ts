import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredToggle(group: Locator) {
  await expect.poll(() => group.evaluate(row => {
    const rowBox = row.getBoundingClientRect();
    const arrowBox = row.querySelector('button')!.getBoundingClientRect();
    return Math.abs(arrowBox.y + arrowBox.height / 2 - rowBox.y - rowBox.height / 2);
  })).toBeLessThanOrEqual(1);
}

for (const mode of ['local', 'remote']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: projectless names in Recent at ${enlarged ? '20px narrow dark' : '14px wide light'}`,
      async ({ page }) => {
        await page.setViewportSize({ width: enlarged ? 860 : 1440, height: enlarged ? 700 : 900 });
        const suffix = `${mode === 'remote' ? '&dialog=1' : ''}${enlarged ? '&font=20&dark=1' : ''}`;
        await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&projectless=1${suffix}`);
        if (mode === 'remote') await page.getByRole('button', { name: '对话同步', exact: true }).click();
        const pane = page.getByRole('region', { name: '对话同步', exact: true });
        const recent = pane.getByRole('row').filter({ has: page.getByText('最近', { exact: true }) });
        await expect(recent).toHaveCount(1);
        await expect(recent.getByRole('cell', { name: '4', exact: true })).toBeVisible();
        for (const name of ['整理本周工作计划', '准备周末出行清单', '临时对话', '未命名对话']) {
          await expect(pane.getByText(name, { exact: true })).toBeVisible();
        }
        await expect(pane.getByText(/codex-gui-workspaces|0300e13d|5f964d75/)).toHaveCount(0);
        await expect(pane.getByText('排查项目中的登录问题', { exact: true })).toBeHidden();
        const project = pane.getByRole('row').filter({ has: page.getByText('F:/projects/remoteai', { exact: true }) });
        for (const group of [recent, project]) await expectCenteredToggle(group);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
        await page.screenshot({ path: `../../.codex-tmp/sync-recent-${mode}-${enlarged ? 'font20-dark-narrow'
          : 'font14-light-wide'}.png`, animations: 'disabled' });
        await recent.getByRole('checkbox').check();
        await pane.getByRole('button', { name: '收起: 最近', exact: true }).click();
        await expect(pane.getByText('整理本周工作计划', { exact: true })).toBeHidden();
        await pane.getByRole('button', { name: '展开: 最近', exact: true }).click();
        await pane.getByRole('row').filter({ has: page.getByText('整理本周工作计划', { exact: true }) })
          .getByRole('checkbox').uncheck();
        await expect(recent.getByRole('checkbox')).toBeChecked({ indeterminate: true });
        await pane.getByRole('button', { name: '对话同步', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '确认同步对话？' })).toBeVisible();
        const ids = await page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
          request: { action: string; sessionIds?: string[] } }[])
          .find(call => ['prepare', 'export'].includes(call.request.action))?.request.sessionIds);
        expect(ids?.sort()).toEqual(['no-project', 'scratch-unix', 'untitled']);
      });
  }
}

for (const mode of ['local', 'remote']) {
  test(`${mode}: toggle stays centered when the project name and path wrap`, async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 700 });
    await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&wrapping=1&font=20&dark=1`);
    const pane = page.getByRole('region', { name: '对话同步', exact: true });
    const project = pane.getByRole('row').filter({ has: page.getByText(/^F:\/projects\/customer-workspaces\//) });
    await expect(project).toBeVisible();
    expect((await project.boundingBox())!.height).toBeGreaterThan(80);
    await expectCenteredToggle(project);
    await project.getByRole('button').click();
    await expect(pane.getByText('排查项目中的登录问题', { exact: true })).toBeVisible();
    await expectCenteredToggle(project);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `../../.codex-tmp/sync-alignment-${mode}-font20-dark-wrapped.png`,
      animations: 'disabled' });
  });
}

test('search displays a named projectless conversation inside Recent', async ({ page }) => {
  await page.goto('/e2e/conversation-sync-harness.html?mode=local&projectless=1');
  const pane = page.getByRole('region', { name: '对话同步', exact: true });
  await pane.getByPlaceholder('搜索标题和对话内容').fill('本周工作');
  await expect(pane.getByText('最近', { exact: true })).toBeVisible();
  await expect(pane.getByText('整理本周工作计划', { exact: true })).toBeVisible();
  await expect(pane.getByText('准备周末出行清单', { exact: true })).toBeHidden();
});
