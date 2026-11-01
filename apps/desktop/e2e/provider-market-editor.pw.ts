import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectMarketDialogLayout, fixtureItem, setupMarket } from './provider-market-support';
async function fillPublication(page: Page) {
  await page.getByLabel('Provider 名称', { exact: true }).fill('模力方舟');
  await page.getByLabel('服务地址', { exact: true }).fill('https://provider.example/v1');
  await page.getByLabel('页面地址（发布必填）', { exact: true }).fill('https://provider.example/dashboard');
  await page.getByLabel('模型 ID', { exact: true }).first().fill('model-z');
}

async function captureFixedActions(page: Page, info: TestInfo, name: string) {
  const body = page.locator('.provider-market-modal .ant-modal-body');
  const footer = page.locator('.provider-market-modal .ant-modal-footer');
  const publish = footer.getByRole('button', { name: '发布', exact: true });
  await body.evaluate(node => { node.scrollTop = 0; });
  await expectMarketDialogLayout(page);
  await expect(publish).toBeInViewport();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  const before = (await publish.boundingBox())!;
  const frame = (await page.locator('.ant-modal-content').boundingBox())!;
  expect(frame.x + frame.width - before.x - before.width).toBeCloseTo(24, 0);
  expect(frame.y + frame.height - before.y - before.height).toBeCloseTo(16, 0);
  await page.screenshot({ path: info.outputPath(`${name}-top.png`) });
  await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await body.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  expect((await publish.boundingBox())!.y).toBe(before.y);
  await expect(footer.getByRole('button', { name: '取消', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`${name}-bottom.png`) });
}

for (const mode of ['local', 'hosted']) {
  for (const dark of [false, true]) {
    test(`${mode}: ${dark ? 'narrow dark' : 'wide light'} fixed publication actions and review status`, async ({ page }, info) => {
      const state = await setupMarket(page, mode);
      state.setItem({ ...fixtureItem(), marketingBadge: { text: '限时优惠', tone: 'orange' } });
      await page.setViewportSize({ width: dark ? 640 : 1440, height: 900 });
      await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&language=zh${dark ? '&dark=1' : ''}`);
      await page.locator('.provider-market-button').first().click();
      const name = `${mode}-${dark ? 'dark-narrow' : 'light-wide'}`;
      await expect(page.locator('.pm-marketing-badge')).toHaveText('限时优惠');
      await page.screenshot({ path: info.outputPath(`${name}-badge.png`) });
      await page.getByRole('button', { name: '发布 Provider', exact: true }).click();
      await page.getByRole('button', { name: '发布', exact: true }).click();
      await expect(page.locator('.pm-editor .ant-alert-error')).toBeInViewport();
      expect(state.publications).toHaveLength(0);
      await fillPublication(page);
      await captureFixedActions(page, info, `${name}-new`);
      await page.getByRole('button', { name: '发布', exact: true }).click();
      await expect.poll(() => state.publications.length).toBe(1);
      await expect(page.getByText('已提交审核，通过后将在市场展示。', { exact: true })).toBeVisible();
      await expect(page.locator('.pm-card').getByText('待审核', { exact: true })).toBeVisible();
      await page.getByText('全部', { exact: true }).click();
      await expect(page.locator('.pm-card')).toHaveCount(0);
      await page.getByText('我的发布', { exact: true }).click();
      await page.getByRole('button', { name: '更多操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
      await captureFixedActions(page, info, `${name}-edit`);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      expect(state.publications).toHaveLength(1);
      state.setItem({ ...fixtureItem(), reviewStatus: 'rejected', reviewReason: '请补充模型价格说明' });
      await page.getByText('全部', { exact: true }).click();
      await page.getByText('我的发布', { exact: true }).click();
      await expect(page.getByText('未通过原因：请补充模型价格说明', { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${name}-rejected.png`) });
    });
  }
}

test('fixed publish actions prevent duplicate submissions while the page remains responsive', async ({ page }) => {
  const state = await setupMarket(page, 'hosted');
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/__codex_switch__/api/invoke', async route => {
    if (route.request().postDataJSON().args?.request?.type === 'save') await pending;
    await route.fallback();
  });
  await page.goto('/e2e/provider-market-harness.html?mode=hosted');
  await page.locator('.provider-market-button').first().click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Provider name', { exact: true })).toBeDisabled();
  const beats = Number(await page.getByTestId('beats').textContent());
  await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(beats + 3);
  finish();
  await expect.poll(() => state.publications.length).toBe(1);
  await expect(page.locator('.pm-editor')).toHaveCount(0);
});
