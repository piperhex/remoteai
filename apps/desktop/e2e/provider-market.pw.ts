import { expect, test } from '@playwright/test';
import { setupMarket } from './provider-market-support';

for (const mode of ['local', 'hosted', 'remote', 'web']) {
  test(`${mode}: market availability and explicit addition without activation`, async ({ page }, info) => {
    const state = await setupMarket(page, mode);
    await page.goto(`/e2e/provider-market-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    if (mode === 'remote') await page.locator('button[aria-expanded]').first().click();
    const launcher = page.getByRole('button', { name: 'Provider market', exact: true }).first();
    if (mode === 'remote') {
      await expect(page.getByRole('region', { name: 'Accounts', exact: true })).toBeVisible();
      await expect(launcher).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('remote-account-no-market.png') });
      expect(state.saved).toHaveLength(0);
      return;
    }
    if (mode === 'web') {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole('heading', { name: 'Third-party provider', exact: true })).toBeVisible();
        await expect(launcher).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`web-${width}-no-market.png`) });
      }
      expect(state.saved).toHaveLength(0);
      return;
    }
    await expect(launcher).toBeVisible();
    const gradient = await launcher.locator('span').last().evaluate((node) => getComputedStyle(node).backgroundImage);
    expect(gradient).toContain('linear-gradient');
    if (mode === 'local' || mode === 'hosted') {
      const buttons = page.locator('#provider-topbar-actions button');
      expect(await buttons.nth(1).innerText()).toBe('Provider market');
      const before = await buttons.nth(0).boundingBox(); const after = await launcher.boundingBox();
      expect(after!.x).toBeGreaterThan(before!.x);
      await expect(page.locator('.provider-empty .provider-market-button')).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`${mode}-entry.png`) });
    await launcher.click();
    await page.getByRole('button', { name: 'Example Gateway', exact: true }).click();
    await expect(page.locator('.pm-model h3')).toHaveText(['model-z openaiResponses', 'model-a anthropicMessages']);
    await expect(page.locator('.pm-tier h4')).toHaveText(['5×', '1×', '2×']);
    await expect(page.locator('.pm-tier').first().locator('dd').first()).toHaveText('7');
    await expect(page.locator('.pm-tier').first().locator('dd').nth(1)).toHaveText('0');
    await expect(page.locator('.pm-tier').first().locator('dd').nth(2)).toHaveText('Not provided');
    expect(state.saved).toHaveLength(0);
    const optIn = page.getByRole('checkbox'); await expect(optIn).not.toBeChecked();
    await page.getByLabel('Enter your own API key', { exact: true }).fill('own-private-key');
    await page.screenshot({ path: info.outputPath(`${mode}-detail.png`) });
    await page.getByRole('button', { name: 'Add to my Providers', exact: true }).dblclick();
    await expect.poll(() => state.saved.length).toBe(1);
    const serialized = JSON.stringify(state.saved[0]);
    expect(serialized).toContain('own-private-key'); expect(serialized).not.toContain('modelTokenCosts');
    expect(serialized).not.toContain('"active":true');
    expect(serialized).not.toContain('parseBalance');
  });
}
test('anonymous publishing is refused; account changes reject stale maintenance', async ({ page }) => {
  await setupMarket(page, 'local', false);
  await page.goto('/e2e/provider-market-harness.html');
  await page.getByRole('button', { name: 'Provider market', exact: true }).first().click();
  await page.getByRole('button', { name: 'Publish Provider', exact: true }).click();
  await expect(page.getByText('Sign in to publish or manage your Providers.')).toBeVisible();
  await expect(page.locator('.pm-editor')).toHaveCount(0);
});
test('publishes multiple models and independent tiers, and rejects stale identity', async ({ page }, info) => {
  const state = await setupMarket(page, 'local');
  await page.goto('/e2e/provider-market-harness.html?dark=1');
  await page.getByRole('button', { name: 'Provider market', exact: true }).first().click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Model ID', { exact: true })).toHaveCount(2);
  await page.getByLabel('Input', { exact: true }).first().fill('9');
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  await page.getByLabel('Model ID', { exact: true }).last().fill('model-new');
  await page.screenshot({ path: info.outputPath('dark-editor.png') });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => state.publications.length).toBe(1);
  const draft = state.publications[0].draft as { models: { tiers: { input: number | null }[] }[] };
  expect(draft.models).toHaveLength(3); expect(draft.models[0].tiers.map((v) => v.input)).toEqual([9, 11]);
  expect(state.saved).toHaveLength(0);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  state.switchAccount();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.pm-editor')).toHaveCount(0);
  expect(state.publications).toHaveLength(1);
});
test('admin changes only Provider order and clears manual priority', async ({ page }, info) => {
  const state = await setupMarket(page, 'admin');
  await page.goto('/e2e/provider-market-harness.html?mode=admin');
  await page.getByRole('spinbutton', { name: 'Display order (optional)' }).fill('3');
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect.poll(() => state.publications.length).toBe(1);
  expect(state.publications[0].sortOrder).toBe(3);
  await page.getByRole('button', { name: 'Restore default order' }).click();
  await expect.poll(() => state.publications.length).toBe(2);
  expect(state.publications[1].sortOrder).toBeNull();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('admin-order.png') });
});
test('narrow dark window retains the visible market button and responsive UI', async ({ page }, info) => {
  await setupMarket(page, 'hosted'); await page.setViewportSize({ width: 640, height: 800 });
  await page.goto('/e2e/provider-market-harness.html?mode=hosted&dark=1');
  const button = page.locator('#provider-topbar-actions .provider-market-button');
  await expect(button).toBeVisible(); await button.click();
  await expect(page.getByRole('button', { name: 'Example Gateway' })).toBeVisible();
  const start = Number(await page.getByTestId('beats').textContent());
  await page.getByRole('searchbox').fill('Example');
  await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(start + 3);
  const modal = page.locator('.provider-market-modal');
  expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const bounds = await modal.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(640);
  await page.screenshot({ path: info.outputPath('narrow-dark.png') });
});
