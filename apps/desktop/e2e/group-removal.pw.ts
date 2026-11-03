import { expect, test, type Locator, type Page } from '@playwright/test';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const output = '../../.codex-tmp/group-removal';
const projectName = 'remote-ai';
const threadName = '分组设计讨论';

async function hold(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing long-press target');
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true,
    button: 0, clientX: box.x + 20, clientY: box.y + 10 });
  await expect(target.page().getByText('移动到分组', { exact: true })).toBeVisible();
  await target.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1 });
}

async function openMove(page: Page, options: { name: string; mobile: boolean; touch?: boolean }) {
  const target = page.getByRole('button', { name: options.name, exact: true });
  if (options.mobile || options.touch) await hold(target);
  else await target.click({ button: 'right' });
  const move = page.getByRole(options.mobile ? 'button' : 'menuitem', { name: '移动到分组' });
  if (options.mobile) await move.click();
  else await move.hover();
  await expect(page.getByRole(options.mobile ? 'button' : 'menuitem', { name: '取消分组', exact: true })).toBeVisible();
  await expect(page.getByRole(options.mobile ? 'button' : 'menuitem', { name: '未分组', exact: true })).toHaveCount(0);
}

for (const entry of [{ mode: 'local', mobile: false }, { mode: 'remote', mobile: false },
  { mode: 'web', mobile: false }, { mode: 'web', mobile: true }]) {
  for (const dark of [false, true]) {
    const label = `${entry.mode}-${entry.mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`;
    test(`${label}: remove grouping restores project and keeps projectless conversations`, async ({ page }) => {
      await page.setViewportSize(entry.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await page.goto(`/e2e/custom-groups-harness.html?mode=${entry.mode}&restore${dark ? '&dark' : ''}`);
      const project = page.getByRole('region', { name: projectName, exact: true });
      await openMove(page, { name: threadName, mobile: entry.mobile });
      await page.screenshot({ path: `${output}/${label}-cancel-menu.png`, animations: 'disabled' });
      await page.getByRole(entry.mobile ? 'button' : 'menuitem', { name: '取消分组', exact: true }).click();
      await expect(project.getByRole('button', { name: threadName, exact: true })).toBeVisible();
      // Existing null placements must also be recoverable after upgrading.
      await openMove(page, { name: '发布检查清单', mobile: entry.mobile, touch: true });
      await page.getByRole(entry.mobile ? 'button' : 'menuitem', { name: '取消分组', exact: true }).click();
      await expect(project.getByRole('button', { name: '发布检查清单', exact: true })).toBeVisible();
      await openMove(page, { name: '无项目对话', mobile: entry.mobile });
      await page.getByRole(entry.mobile ? 'button' : 'menuitem', { name: '取消分组', exact: true }).click();
      await expect(project.getByRole('button', { name: '无项目对话', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '无项目对话', exact: true })).toBeVisible();
      await page.reload();
      await expect(project.getByRole('button', { name: threadName, exact: true })).toBeVisible();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch:gui-custom-groups')!));
      expect(saved.threads).toEqual({});
      expect(saved.projects).toEqual({ '/workspace/remote-ai': 'client' });
      await page.screenshot({ path: `${output}/${label}-restored.png`, animations: 'disabled' });
      const projectButton = entry.mode === 'web' ? '折叠项目：remote-ai' : projectName;
      await openMove(page, { name: projectButton, mobile: entry.mobile });
      await page.getByRole(entry.mobile ? 'button' : 'menuitem', { name: '取消分组', exact: true }).click();
      await page.getByRole('button', { name: '折叠分组：工作', exact: true }).click();
      await expect(project.getByRole('button', { name: threadName, exact: true })).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch:gui-custom-groups')!).projects))
        .toEqual({});
    });
  }
}

test('batch removal returns each selected conversation to its own project', async ({ page }) => {
  await page.goto('/e2e/custom-groups-harness.html?mode=local&restore');
  await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
  await page.getByRole('tab', { name: '项目与对话' }).click();
  for (const name of [threadName, '发布检查清单', '无项目对话']) {
    await page.getByRole('row').filter({ hasText: name }).getByRole('checkbox').check();
  }
  await expect(page.locator('.chat-group-destination')).toContainText('取消分组');
  await page.getByRole('button', { name: '应用分组', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('codex-switch:gui-custom-groups')!).threads)).toEqual({});
});
