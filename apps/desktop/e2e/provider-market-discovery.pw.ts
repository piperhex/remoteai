import { expect, test, type Page } from '@playwright/test';
import { setupMarket } from './provider-market-support';

async function expectModelIds(page: Page, ids: string[]) {
  const fields = page.getByLabel('模型 ID', { exact: true });
  await expect(fields).toHaveCount(ids.length);
  for (const [index, id] of ids.entries()) await expect(fields.nth(index)).toHaveValue(id);
}

async function openEditor(page: Page, mode: string, dark = false) {
  await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&language=zh${dark ? '&dark=1' : ''}`);
  await page.locator('.provider-market-button').first().click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
}

for (const mode of ['local', 'hosted']) {
  for (const dark of [false, true]) {
    const scenario = `${mode} ${dark ? 'dark narrow' : 'light wide'}`;
    test(`${scenario} imports models and preserves publication edits`, async ({ page }, info) => {
      const state = await setupMarket(page, mode);
      await page.setViewportSize({ width: dark ? 760 : 1600, height: 1000 });
      await openEditor(page, mode, dark);
      const fetchButton = page.getByRole('button', { name: '拉取模型列表', exact: true });
      const url = page.getByLabel('服务地址', { exact: true });
      const addressBox = (await url.boundingBox())!;
      const buttonBox = (await fetchButton.boundingBox())!;
      expect(buttonBox.x).toBeGreaterThan(addressBox.x + addressBox.width);
      expect(buttonBox.y).toBeCloseTo(addressBox.y, 0);
      await page.getByText('拉取选项（密钥与协议）', { exact: true }).click();
      await page.getByLabel('API 密钥（可选，仅用于拉取）', { exact: true }).fill('private-discovery-key');
      await fetchButton.click();
      await expect(page.locator('.pm-model-discovery').getByRole('status')).toContainText('已添加 1 个模型');
      expect(state.discoveryRequests).toEqual([{ baseUrl: 'https://provider.example/v1',
        apiKey: 'private-discovery-key', providerId: null, options: { apiFormat: 'openaiResponses' } }]);
      await expect(page.getByLabel('模型 ID', { exact: true })).toHaveCount(3);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-fetch.png`) });
      const model = page.locator('.pm-model-editor').last();
      await model.scrollIntoViewIfNeeded();
      await expect(model.getByLabel('模型 ID', { exact: true })).toHaveValue('model-new');
      await expect(model.getByRole('spinbutton', { name: '倍率', exact: true })).toHaveValue('1');
      await expect(model.locator('.pm-price-fields input').first()).toHaveValue('');
      const outline = model.locator('.pm-model-outline rect');
      await expect(outline).toHaveCSS('stroke-dasharray', '8px, 4px, 2px, 4px');
      expect((await outline.boundingBox())!.height).toBeGreaterThan(300);
      const frameName = `${mode}-${dark ? 'dark-narrow' : 'light-wide'}-model-frame.png`;
      await page.screenshot({ path: info.outputPath(frameName) });
      await page.getByRole('button', { name: '发布', exact: true }).click();
      await expect.poll(() => state.publications.length).toBe(1);
      const payload = state.publications[0];
      expect(JSON.stringify(payload)).not.toContain('private-discovery-key');
      expect(payload).toMatchObject({ draft: { models: [
        { id: 'model-z', protocol: 'openaiResponses', tiers: [
          { multiplier: 5, input: 7, output: 0 },
          { multiplier: 1, input: 11, longContextThreshold: 200000, longContext: { input: 13, cachedInput: 0 } },
        ] },
        { id: 'model-a', protocol: 'anthropicMessages', tiers: [{ multiplier: 2 }] },
        { id: 'model-new', protocol: 'openaiResponses', tiers: [{ multiplier: 1, input: null }] },
      ] } });
    });
  }
}

test('new publication imports into the empty row without requiring a key', async ({ page }) => {
  const state = await setupMarket(page, 'local');
  await page.goto('/e2e/provider-market-harness.html?language=zh');
  await page.locator('.provider-market-button').first().click();
  await page.getByRole('button', { name: '发布 Provider', exact: true }).click();
  const fetchButton = page.getByRole('button', { name: '拉取模型列表', exact: true });
  await expect(fetchButton).toBeDisabled();
  await page.getByLabel('服务地址', { exact: true }).fill('https://provider.example/v1');
  await fetchButton.click();
  await expect(page.locator('.pm-model-discovery').getByRole('status')).toContainText('已添加 2 个模型');
  await expectModelIds(page, ['model-z', 'model-new']);
  expect(state.discoveryRequests[0].apiKey).toBe('');
});

test('slow discovery stays responsive and discards stale results', async ({ page }, info) => {
  const state = await setupMarket(page, 'hosted');
  let finish!: (ids: string[]) => void;
  state.setDiscovery(() => new Promise(resolve => { finish = resolve; }));
  await openEditor(page, 'hosted');
  const fetchButton = page.getByRole('button', { name: '拉取模型列表', exact: true });
  await fetchButton.dblclick();
  await expect.poll(() => state.discoveryRequests.length).toBe(1);
  const beats = Number(await page.getByTestId('beats').textContent());
  await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(beats + 3);
  await page.getByLabel('Provider 名称', { exact: true }).fill('Edited while fetching');
  await page.getByLabel('服务地址', { exact: true }).fill('https://changed.example/v1');
  await page.screenshot({ path: info.outputPath('hosted-light-loading-responsive.png') });
  finish(['stale-model']);
  await expect(fetchButton).not.toHaveClass(/ant-btn-loading/);
  await expectModelIds(page, ['model-z', 'model-a']);
  state.setDiscovery(async () => []);
  await fetchButton.click();
  await expect(page.locator('.pm-model-discovery').getByRole('alert')).toContainText('没有找到可导入的模型');
  await page.screenshot({ path: info.outputPath('hosted-light-empty-retry.png') });
  state.setDiscovery(async () => ['model-b']);
  await fetchButton.click();
  await expect(page.locator('.pm-model-discovery').getByRole('status')).toContainText('已添加 1 个模型');
  await expect(page.getByLabel('Provider 名称', { exact: true })).toHaveValue('Edited while fetching');
});

test('admin browser editor fetches from the service and allows retry after failure', async ({ page }, info) => {
  await setupMarket(page, 'admin');
  let fail = true;
  await page.route('https://provider.example/v1/models', route => fail
    ? route.fulfill({ status: 401, json: {} })
    : route.fulfill({ json: { data: [{ id: 'model-browser' }] } }));
  await page.goto('/e2e/provider-market-harness.html?mode=admin&language=zh');
  await page.getByRole('button', { name: '发布 Provider', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://provider.example/v1');
  await page.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  await expect(page.locator('.pm-model-discovery').getByRole('alert')).toContainText('拉取失败');
  await page.screenshot({ path: info.outputPath('admin-web-light-fetch-failed.png') });
  fail = false;
  await page.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  await expect(page.locator('.pm-model-discovery').getByRole('status')).toContainText('已添加 1 个模型');
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('model-browser');
  await page.screenshot({ path: info.outputPath('admin-web-light-fetch-success.png') });
});
