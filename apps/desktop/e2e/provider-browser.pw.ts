import { expect, test } from '@playwright/test';
import { setupMarket } from './provider-market-support';

test('publishing requires a page and persists query strings and custom headers', async ({ page }, info) => {
  const state = await setupMarket(page, 'local');
  await page.goto('/e2e/provider-market-harness.html?language=zh');
  await page.locator('#provider-topbar-actions .provider-market-button').click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const address = page.getByLabel('页面地址（发布必填）', { exact: true });
  await address.fill('');
  await page.getByRole('button', { name: /^发\s*布$/ }).click();
  expect(state.publications).toHaveLength(0);
  await expect(page.getByRole('alert').last()).toContainText('请填写有效的页面地址');
  await address.fill('https://provider.example/dashboard?view=usage#balance');
  await page.getByLabel('查询字符串', { exact: true }).fill('tag=a&tag=b&source=remoteai');
  await page.getByLabel('自定义请求头', { exact: true }).fill('{"X-Source":"RemoteAI"}');
  await page.locator('.pm-page-link').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('desktop-local-publish-page-settings.png') });
  await page.getByRole('button', { name: /^发\s*布$/ }).click();
  await expect.poll(() => state.publications.length).toBe(1);
  expect(state.publications[0].draft).toMatchObject({ pageLink: {
    url: 'https://provider.example/dashboard?view=usage#balance', query: 'tag=a&tag=b&source=remoteai',
    headers: { 'X-Source': 'RemoteAI' },
  } });
});

for (const mode of ['local', 'hosted']) {
  test(`${mode}: only market Providers open tabs from names and actions`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMarket(page, mode);
    await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&browser=1&language=zh`);
    await expect(page.getByRole('button', { name: '前往页面', exact: true })).toHaveCount(2);
    await page.screenshot({ path: info.outputPath(`${mode}-provider-list.png`) });
    const name = page.locator('.provider-link').filter({ hasText: 'Market Gateway' });
    await name.click();
    await expect(page.getByRole('dialog', { name: 'Provider 浏览器' })).toBeVisible();
    await expect(page.getByLabel('页面地址', { exact: true })).toHaveValue(
      'http://127.0.0.1:1500/dashboard?view=usage&source=remoteai&tag=a&tag=b#balance');
    if (mode === 'hosted') await expect(page.locator('.pm-browser-feedback')).toContainText('请在 Windows 桌面客户端中打开');
    const bounds = await page.locator('.pm-browser').boundingBox();
    expect(bounds!.width).toBeCloseTo(1280 * .85, 0); expect(bounds!.height).toBeCloseTo(900 * .85, 0);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '前往页面', exact: true }).nth(1).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('button', { name: '新标签页', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.locator('.pm-browser-feedback:visible')).toContainText('在地址栏输入网址');
    await page.screenshot({ path: info.outputPath(`${mode}-browser-tabs.png`) });
    await page.getByRole('button', { name: '全屏展示', exact: true }).click();
    const full = await page.locator('.pm-browser').boundingBox();
    expect(full!.width).toBe(1280); expect(full!.height).toBe(900);
    await page.screenshot({ path: info.outputPath(`${mode}-browser-fullscreen.png`) });
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await page.getByRole('button', { name: '关闭 新标签页' }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    const start = Number(await page.getByTestId('beats').textContent());
    await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(start + 3);
  });
}

test('hosted dark narrow card view retains market-only page actions', async ({ page }, info) => {
  await setupMarket(page, 'hosted'); await page.setViewportSize({ width: 900, height: 760 });
  await page.goto('/e2e/provider-market-harness.html?mode=hosted&browser=1&cards=1&dark=1&language=zh');
  await expect(page.getByRole('button', { name: '前往页面', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Market Gateway', exact: true }).click();
  await expect(page.locator('.pm-browser-feedback')).toContainText('自定义请求头');
  await page.screenshot({ path: info.outputPath('hosted-dark-browser.png') });
});

test('admin publication uses the same required page settings', async ({ page }, info) => {
  const state = await setupMarket(page, 'admin');
  await page.goto('/e2e/provider-market-harness.html?mode=admin');
  await page.getByRole('button', { name: 'Publish Provider', exact: true }).click();
  const field = page.getByLabel('Page URL (required to publish)', { exact: true });
  await expect(field).toHaveAttribute('aria-required', 'true');
  await field.fill('https://example.test/dashboard');
  await page.getByLabel('Query string', { exact: true }).fill('source=remoteai');
  await page.getByLabel('Custom headers', { exact: true }).fill('{"X-Region":"east"}');
  await page.locator('.pm-page-link').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('admin-page-settings.png') });
  expect(state.publications).toHaveLength(0);
});
