import { expect, test, type Page } from '@playwright/test';
import { setupAdminTable } from './provider-market-admin-table-support';

async function captureDialog(page: Page, path: string) {
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.ant-modal')).not.toHaveClass(/zoom-enter|zoom-appear/);
  await page.screenshot({ path, animations: 'disabled' });
}

for (const dark of [false, true]) {
  test(`admin table ${dark ? 'dark narrow' : 'light wide'} bulk actions and conflicts`, async ({ page }, info) => {
    await page.setViewportSize({ width: dark ? 760 : 1600, height: 1000 });
    const state = await setupAdminTable(page, { dark });
    const market = page.locator('.pm-admin-market');
    await expect(market.locator('tbody tr[data-row-key]')).toHaveCount(6);
    await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 YYLX', exact: true }).check();
    await expect(market.getByText('已选择 2 条')).toBeVisible();
    await expect(page.getByRole('button', { name: '批量通过', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath('selected.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '批量通过', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('所选的 2 个 Provider');
    await captureDialog(page, info.outputPath('approve-confirm.png'));
    await page.getByRole('dialog').getByRole('button', { name: '批量通过', exact: true }).click();
    await expect(market.getByText('已选择 0 条')).toBeVisible();
    expect(state.mutations[0].body).toMatchObject({ decision: 'approved', reason: '', items: [
      { id: '11111111-1111-4111-8111-000000000001', revision: 1 },
      { id: '11111111-1111-4111-8111-000000000002', revision: 1 },
    ] });
    await expect(market.getByText('已发布', { exact: true })).toHaveCount(3);
    await page.getByRole('checkbox', { name: '选择 XycAi', exact: true }).check();
    await page.getByRole('button', { name: '批量驳回', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '批量驳回', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: '驳回原因（必填）' }).fill('请补充价格说明');
    await captureDialog(page, info.outputPath('reject-reason.png'));
    await dialog.getByRole('button', { name: '批量驳回', exact: true }).click();
    await expect(market.getByText('未通过审核', { exact: true })).toHaveCount(2);
    expect(state.mutations[1].body).toMatchObject({ decision: 'rejected', reason: '请补充价格说明' });
    await page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 Remote AI 官方', exact: true }).check();
    await expect(page.getByRole('button', { name: '批量通过', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '批量删除', exact: true }).click();
    await expect(dialog).toBeVisible();
    await captureDialog(page, info.outputPath('delete-confirm.png'));
    await dialog.getByRole('button', { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    expect(state.mutations).toHaveLength(2);
    state.setConflict(true);
    await page.getByRole('button', { name: '批量删除', exact: true }).click();
    await dialog.getByRole('button', { name: '批量删除', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('内容已更新');
    await expect(market.locator('tbody tr[data-row-key]')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath('conflict.png'), animations: 'disabled' });
    state.setConflict(false);
    await dialog.getByRole('button', { name: '批量删除', exact: true }).click();
    await expect(market.locator('tbody tr[data-row-key]')).toHaveCount(4);
    await expect(market.getByText('已选择 0 条')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('completed.png'), fullPage: true, animations: 'disabled' });
  });
}

test('selection clears on filtering and paging, and deleting the last page returns to a valid page', async ({ page }) => {
  const state = await setupAdminTable(page, { count: 41 });
  await page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true }).check();
  await page.getByRole('searchbox', { name: '搜索 Provider 名称' }).fill('YYLX');
  await page.getByRole('searchbox', { name: '搜索 Provider 名称' }).press('Enter');
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(1);
  await expect(page.getByText('已选择 0 条')).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索 Provider 名称' }).fill('');
  await page.getByRole('searchbox', { name: '搜索 Provider 名称' }).press('Enter');
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(40);
  await page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true }).check();
  await page.locator('.ant-pagination-item-2').click();
  await expect(page.getByText('已选择 0 条')).toBeVisible();
  await page.getByRole('checkbox', { name: '选择 Provider 41', exact: true }).check();
  await page.getByRole('button', { name: '批量删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '批量删除', exact: true }).click();
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(40);
  await expect(page.locator('.ant-pagination-item-active')).toHaveText('1');
  expect(state.mutations[0].body.items).toHaveLength(1);
});

test('readers and reviewers only see actions their permissions allow', async ({ page }) => {
  await setupAdminTable(page, { role: 'read' });
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(6);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批量通过', exact: true })).toHaveCount(0);
});

test('reviewers select only pending community entries and cannot delete', async ({ page }) => {
  await setupAdminTable(page, { role: 'review' });
  await expect(page.getByRole('checkbox', { name: '选择 Remote AI 官方', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择 未通过示例', exact: true })).toBeDisabled();
  await page.locator('thead').getByRole('checkbox').check();
  await expect(page.getByText('已选择 3 条')).toBeVisible();
  await expect(page.getByRole('button', { name: '批量通过', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0);
});

test('English and Russian copy work offline after language switching', async ({ page }, info) => {
  await setupAdminTable(page, { language: 'en' });
  await expect(page.getByRole('button', { name: 'Approve selected', exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.locator('.app-header .ant-select').click();
  await page.getByTitle('Русский', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Одобрить выбранные', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('russian.png'), fullPage: true });
});

for (const dark of [false, true]) {
  test(`inline order ${dark ? 'dark narrow' : 'light wide'} saves on blur with consistent actions`, async ({ page }, info) => {
    await page.setViewportSize({ width: dark ? 760 : 1600, height: 1000 });
    const state = await setupAdminTable(page, { dark });
    const input = page.getByRole('spinbutton', { name: '调整 魔力方舟 的展示顺序', exact: true });
    await expect(input).toHaveAttribute('placeholder', '自动排序');
    await input.fill('2');
    expect(state.mutations).toHaveLength(0);
    await input.press('Tab');
    await expect.poll(() => state.mutations.length).toBe(1);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('2');
    expect(state.mutations[0].body).toEqual({ sortOrder: 2, revision: 1 });
    await input.focus();
    await input.press('Tab');
    expect(state.mutations).toHaveLength(1);
    const actions = input.locator('xpath=ancestor::tr').locator('td:last-child .ant-btn');
    const styles = await actions.evaluateAll(buttons => buttons.map(button => {
      const style = getComputedStyle(button);
      return [style.height, style.fontSize, style.paddingInline, style.borderRadius, style.borderStyle];
    }));
    expect(styles).toHaveLength(3);
    expect(styles[1]).toEqual(styles[0]);
    expect(styles[2]).toEqual(styles[0]);
    await actions.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('inline-order-saved-actions.png'), animations: 'disabled' });
    await input.fill('');
    await input.press('Tab');
    await expect.poll(() => state.mutations.length).toBe(2);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    expect(state.mutations[1].body).toEqual({ sortOrder: null, revision: 2 });
    await input.fill('0');
    await input.press('Tab');
    await expect.poll(() => state.mutations.length).toBe(3);
    await expect(input).toBeEnabled();
    expect(state.mutations[2].body).toEqual({ sortOrder: 0, revision: 3 });
    state.setConflict(true);
    await input.fill('8');
    await input.press('Tab');
    await expect(page.getByRole('alert')).toContainText('内容已更新');
    await expect(input).toHaveValue('0');
    await page.screenshot({ path: info.outputPath('inline-order-conflict.png'), animations: 'disabled' });
  });
}

test('inline order normalizes integer bounds before saving on blur', async ({ page }) => {
  const state = await setupAdminTable(page);
  const input = page.getByRole('spinbutton', { name: '调整 魔力方舟 的展示顺序', exact: true });
  for (const [index, [typed, saved]] of [['-1', 0], ['1000001', 1_000_000], ['2.6', 3]].entries()) {
    await input.fill(String(typed));
    await input.press('Tab');
    await expect.poll(() => state.mutations.length).toBe(index + 1);
    await expect(input).toBeEnabled();
    expect(state.mutations[index].body).toEqual({ sortOrder: saved, revision: index + 1 });
    await expect(input).toHaveValue(String(saved));
  }
});

test('bulk requests lock selection and prevent duplicate submission', async ({ page }) => {
  const state = await setupAdminTable(page);
  let release: (() => void) | undefined;
  await page.route('**/admin/api/provider-market/batch/review', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fallback();
  });
  await page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true }).check();
  await page.getByRole('button', { name: '批量通过', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '批量通过', exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await expect(page.getByRole('checkbox', { name: '选择 魔力方舟', exact: true })).toBeDisabled();
  await expect(page.getByRole('searchbox', { name: '搜索 Provider 名称' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release!();
  await expect(dialog).toBeHidden();
  expect(state.mutations).toHaveLength(1);
});
