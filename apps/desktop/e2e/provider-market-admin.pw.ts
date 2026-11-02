import { expect, test } from '@playwright/test';
import { fixtureItem, setupMarket } from './provider-market-support';

for (const dark of [false, true]) {
  test(`admin: ${dark ? 'dark narrow' : 'light wide'} reviews and controls marketing badges`, async ({ page }, info) => {
    const state = await setupMarket(page, 'admin');
    state.setItem({ ...fixtureItem(), reviewStatus: 'pending' });
    await page.setViewportSize({ width: dark ? 760 : 1440, height: 1000 });
    await page.goto(`/e2e/provider-market-harness.html?mode=admin&language=zh${dark ? '&dark=1' : ''}`);
    await page.getByRole('combobox', { name: '审核状态', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await page.getByTitle('待审核', { exact: true }).click();
    await page.getByRole('button', { name: '查看并审核', exact: true }).click();
    await expect(page.getByText('https://provider.example/v1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '驳回', exact: true })).toBeDisabled();
    await page.getByLabel('驳回原因（必填）', { exact: true }).fill('请补充模型价格说明');
    await page.screenshot({ path: info.outputPath(`admin-${dark ? 'dark-narrow' : 'light-wide'}-review.png`), fullPage: true });
    await page.getByRole('button', { name: '驳回', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(1);
    expect(state.publications[0]).toMatchObject({ decision: 'rejected', reason: '请补充模型价格说明', revision: 1 });
    state.setItem({ ...fixtureItem(), reviewStatus: 'pending', revision: 3 });
    await page.reload();
    await page.getByRole('button', { name: '查看并审核', exact: true }).click();
    await page.getByRole('button', { name: '通过并上架', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(2);
    expect(state.publications[1]).toMatchObject({ decision: 'approved', reason: '', revision: 3 });
    await page.getByRole('button', { name: '营销角标', exact: true }).click();
    await page.getByLabel('角标文字（最多24字）', { exact: true }).fill('限时优惠');
    await expect(page.getByRole('button', { name: '保存角标', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: '保存角标', exact: true }).hover();
    await page.screenshot({ path: info.outputPath(`admin-${dark ? 'dark-narrow' : 'light-wide'}-badge-editor.png`) });
    await page.getByRole('button', { name: '保存角标', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(3);
    expect(state.publications[2]).toMatchObject({ badge: { text: '限时优惠', tone: 'orange' }, revision: 4 });
    await expect(page.locator('.ant-table .pm-marketing-badge')).toHaveText('限时优惠');
    await page.locator('.ant-table .pm-marketing-badge').scrollIntoViewIfNeeded();
    await expect(page.locator('.ant-table .pm-marketing-badge')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`admin-${dark ? 'dark-narrow' : 'light-wide'}-approved-badge.png`) });
    await page.getByRole('button', { name: '营销角标', exact: true }).click();
    await page.getByRole('button', { name: '移除角标', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(4);
    await expect(page.locator('.ant-table .pm-marketing-badge')).toHaveCount(0);
  });
}

test('admin read permission does not expose review or badge actions', async ({ page }) => {
  const state = await setupMarket(page, 'admin');
  state.setItem({ ...fixtureItem(), reviewStatus: 'pending' });
  await page.goto('/e2e/provider-market-harness.html?mode=admin&readOnly=1');
  await expect(page.locator('.ant-table tbody tr[data-row-key]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Marketing badge', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View and review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Example Gateway', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve and publish', exact: true })).toHaveCount(0);
});
