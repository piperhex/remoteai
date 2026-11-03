import { expect, test, type Page } from '@playwright/test';
import type { GroupMembersQuery } from '../../../shared/chat/groups/model';

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
const output = '../../.codex-tmp/group-paging';
const requests = (page: Page) => page.evaluate(() => (window as unknown as {
  groupRequests: { pages: GroupMembersQuery[]; full: number };
}).groupRequests);

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: lazy pages, page size, cross-page assignment and full-history search`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}&paging`);
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '管理分组', exact: true });
    expect(await requests(page)).toEqual({ pages: [], full: 0 });
    await dialog.getByRole('tab', { name: '项目与对话' }).click();
    const rows = dialog.locator('.chat-group-members-table .ant-table-row');
    await expect(rows).toHaveCount(20);
    expect((await requests(page)).pages).toEqual([{ page: 1, pageSize: 20, search: '' }]);
    const selectedOne = await rows.first().getAttribute('data-row-key');
    await rows.first().getByRole('checkbox').check();
    await dialog.locator('.ant-pagination-item-2').click();
    await expect.poll(async () => (await requests(page)).pages.at(-1)?.page).toBe(2);
    await expect(rows.first()).not.toHaveAttribute('data-row-key', selectedOne!);
    const selectedTwo = await rows.first().getAttribute('data-row-key');
    await rows.first().getByRole('checkbox').check();
    await expect(dialog.getByText('已选择 2 项')).toBeVisible();
    await dialog.locator('.ant-pagination-item-1').click();
    await expect(rows.first()).toHaveAttribute('data-row-key', selectedOne!);
    await expect(rows.first().getByRole('checkbox')).toBeChecked();
    expect((await requests(page)).pages.map(query => query.page)).toEqual([1, 2, 1]);
    await dialog.locator('.chat-group-destination .ant-select-selector').click();
    await page.locator('.ant-select-item-option-content').getByText('研究', { exact: true }).click();
    await dialog.getByRole('button', { name: '应用分组' }).click();
    await expect(dialog.locator('.chat-group-batch').getByText('已选择 0 项')).toBeVisible();
    await expect(rows.first()).toContainText('研究');
    await dialog.locator('.ant-pagination-item-2').click();
    await expect(rows.first()).toHaveAttribute('data-row-key', selectedTwo!);
    await expect(rows.first()).toContainText('研究');
    await dialog.locator('.chat-group-members-footer .ant-select-selector').click();
    await page.getByText('每页 50 条', { exact: true }).click();
    await expect(rows).toHaveCount(50);
    expect((await requests(page)).pages.at(-1)).toEqual({ page: 1, pageSize: 50, search: '' });
    await page.screenshot({ path: `${output}/${mode}-light-50.png`, animations: 'disabled' });
    await dialog.getByRole('searchbox', { name: '搜索项目或对话' }).fill('历史对话 234');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('已归档');
    expect((await requests(page)).pages.at(-1)).toEqual({ page: 1, pageSize: 50, search: '历史对话 234' });
    await page.screenshot({ path: `${output}/${mode}-archived-search.png`, animations: 'disabled' });
    expect((await requests(page)).full).toBe(0);
  });

  test(`${mode}: dark compact table fills remaining height and scrolls independently`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}&paging&dark`);
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '管理分组', exact: true });
    await dialog.getByRole('tab', { name: '项目与对话' }).click();
    await expect(dialog.locator('.chat-group-members-table .ant-table-row')).toHaveCount(20);
    const bounds = await dialog.locator('.ant-modal-content').boundingBox();
    expect(bounds!.width).toBeCloseTo(1024 * 0.85, 0);
    expect(bounds!.height).toBeCloseTo(768 * 0.85, 0);
    const footer = dialog.locator('.chat-group-members-footer');
    const before = await footer.boundingBox();
    await dialog.locator('.chat-group-members-table').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('columnheader', { name: '类型', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('searchbox', { name: '搜索项目或对话' })).toBeInViewport();
    await expect(footer).toBeInViewport();
    expect((await footer.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    expect(await dialog.locator('.ant-modal-content').evaluate(element => element.scrollHeight - element.clientHeight))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${output}/${mode}-dark-scrolled.png`, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    const expanded = await dialog.locator('.chat-group-members-table').boundingBox();
    expect(expanded!.height).toBeGreaterThan(400);
    await dialog.getByRole('searchbox', { name: '搜索项目或对话' }).fill('does not exist');
    await expect(dialog.locator('.chat-group-members-table .ant-table-row')).toHaveCount(0);
    await expect(dialog.locator('.chat-group-members-table .ant-empty')).toBeVisible();
    expect((await dialog.locator('.chat-group-members-table').boundingBox())!.height).toBeCloseTo(expanded!.height, 0);
    await page.screenshot({ path: `${output}/${mode}-dark-empty.png`, animations: 'disabled' });
  });
}
