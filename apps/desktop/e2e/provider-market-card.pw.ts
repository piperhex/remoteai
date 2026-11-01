import { expect, test, type Page } from '@playwright/test';
import { expectMarketDialogLayout, fixtureItem, setupMarket } from './provider-market-support';

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

for (const mode of ['local', 'hosted']) {
  test(`${mode}: card body opens addition and menu actions stay separate`, async ({ page }, info) => {
    const state = await setupMarket(page, mode);
    await page.goto(`/e2e/provider-market-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.provider-market-button').first().click();
    const card = page.locator('.pm-card');
    await expect(card.getByRole('button')).toHaveCount(2);
    const bounds = await card.boundingBox();
    await card.click({ position: { x: 12, y: bounds!.height - 12 } });
    await expect(page.getByLabel('Enter your own API key', { exact: true })).toBeVisible();
    await expect(page.locator('.ant-modal-title')).toContainText('Example Gateway');
    await expect(page.getByRole('button', { name: 'Copy share link' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to market' })).toHaveCount(0);
    await expect(page.getByText('Discover third-party connections and add the ones you choose.')).toHaveCount(0);
    expect(state.saved).toHaveLength(0);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const title = page.getByRole('button', { name: 'Example Gateway', exact: true });
    await title.focus(); await page.keyboard.press('Space');
    await expect(page.locator('.pm-install')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Unpublish', 'Delete']);
    await expect(page.locator('.pm-detail')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(page.locator('.pm-editor')).toBeVisible();
    await expect(page.locator('.pm-detail')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('My publications', { exact: true }).click();
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Unpublish', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(1);
    expect(state.publications[0]).toMatchObject({ type: 'save', published: false, revision: 1 });
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Publish again', exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(2);
    expect(state.publications[1]).toMatchObject({ type: 'save', published: true, revision: 2 });
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm deletion', exact: true })).toBeVisible();
    await expect(page.locator('.ant-popconfirm')).toBeInViewport();
    await expect(page.locator('.pm-detail')).toHaveCount(0);
    expect(state.removals).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`${mode}-delete-confirmation.png`) });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.removals).toHaveLength(0);
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await expect.poll(() => state.removals.length).toBe(1);
    expect(state.removals[0]).toMatchObject({ type: 'remove', revision: 3 });
    await expect(card).toHaveCount(0);
    expect(state.saved).toHaveLength(0);
  });

  for (const dark of [false, true]) {
    test(`${mode}: ${dark ? 'narrow dark' : 'wide light'} Chinese card menu and addition`, async ({ page }, info) => {
      const names = ['模力方舟', 'YYLX', 'XycAi', 'xAI (Grok)', 'Vercel AI Gateway', 'V-API'];
      await setupMarket(page, mode, true, async () => ({ total: names.length, items: names.map((name, index) => ({
        ...fixtureItem(), id: `provider-${index}`, name, description: '', balanceQuery: null,
      })) }));
      await page.setViewportSize({ width: dark ? 640 : 1440, height: 900 });
      await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&language=zh${dark ? '&dark=1' : ''}`,
        { waitUntil: 'domcontentloaded' });
      await page.locator('.provider-market-button').first().click();
      const card = page.locator('.pm-card').first();
      await expect(card).toBeVisible();
      await expectMarketDialogLayout(page);
      const more = card.getByRole('button', { name: '更多操作', exact: true });
      const title = await card.locator('.pm-card-title').boundingBox();
      const actions = await more.boundingBox();
      expect(actions!.y).toBe(title!.y);
      expect(actions!.x).toBeGreaterThan(title!.x + title!.width);
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await more.click();
      await expect(page.getByRole('menuitem')).toHaveText(['编辑', '撤下', '删除']);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-menu.png`) });
      await page.keyboard.press('Escape');
      const bounds = await card.boundingBox();
      await card.click({ position: { x: 12, y: bounds!.height - 12 } });
      await expect(page.locator('.pm-install')).toBeVisible();
      await expectMarketDialogLayout(page);
      await expect(page.locator('.pm-detail .pm-page-link')).toHaveCount(0);
      await expect(page.getByText('请求将发送到', { exact: true })).toHaveCount(0);
      await expect(page.getByText(fixtureItem().baseUrl, { exact: true })).toHaveCount(0);
      await page.locator('.pm-install').scrollIntoViewIfNeeded();
      const keyInput = page.locator('.pm-install input');
      await expect(keyInput).toBeInViewport();
      const keyBounds = await keyInput.boundingBox();
      const detailBounds = await page.locator('.pm-detail').boundingBox();
      expect(keyBounds!.y + keyBounds!.height).toBeLessThan(detailBounds!.y);
      const addButton = page.locator('.ant-modal-footer button');
      await expect(addButton).toBeInViewport();
      await expect(addButton).toBeDisabled();
      const footerBefore = await addButton.boundingBox();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-add.png`) });
      await page.locator('.pm-add-modal .ant-modal-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(addButton).toBeInViewport();
      expect((await addButton.boundingBox())!.y).toBe(footerBefore!.y);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-scrolled.png`) });
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.locator('.pm-card')).toHaveCount(names.length);
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test(`${mode}: long names, descriptions and model IDs wrap in a narrow dialog`, async ({ page }, info) => {
    const item = fixtureItem();
    item.name = 'Provider'.repeat(9);
    item.description = 'Details'.repeat(40);
    item.models[0].id = 'model'.repeat(24);
    await setupMarket(page, mode, true, async () => ({ items: [item], total: 1 }));
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto(`/e2e/provider-market-harness.html?mode=${mode}${mode === 'hosted' ? '&dark=1' : ''}`,
      { waitUntil: 'domcontentloaded' });
    await page.locator('.provider-market-button').first().click();
    await expect(page.locator('.pm-card')).toBeVisible();
    await expectMarketDialogLayout(page);
    const title = await page.locator('.pm-card-title > span:last-child').boundingBox();
    expect(title!.height).toBeGreaterThan(36);
    await page.screenshot({ path: info.outputPath(`${mode}-narrow-market-wrapping.png`) });
    await page.locator('.pm-card-title').click();
    await expect(page.locator('.pm-install')).toBeVisible();
    await expectMarketDialogLayout(page);
    await expect(page.locator('.ant-modal-footer button')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`${mode}-narrow-add-wrapping.png`) });
  });
}

test('public cards remain clickable without exposing maintenance actions', async ({ page }) => {
  await setupMarket(page, 'local', false);
  await page.goto('/e2e/provider-market-harness.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.provider-market-button').first().click();
  await expect(page.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0);
  await page.locator('.pm-card').click();
  await expect(page.locator('.pm-install')).toBeVisible();
});

test('pending maintenance disables the card and keeps the interface responsive', async ({ page }) => {
  const state = await setupMarket(page, 'hosted');
  let completeWrite!: () => void;
  const pending = new Promise<void>(resolve => { completeWrite = resolve; });
  await page.route('**/__codex_switch__/api/invoke', async route => {
    if (route.request().postDataJSON().args?.request?.type === 'save') await pending;
    await route.fallback();
  });
  await page.goto('/e2e/provider-market-harness.html?mode=hosted', { waitUntil: 'domcontentloaded' });
  await page.locator('.provider-market-button').first().click();
  await page.getByText('My publications', { exact: true }).click();
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'More actions', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Example Gateway', exact: true })).toBeDisabled();
  const beats = Number(await page.getByTestId('beats').textContent());
  await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(beats + 3);
  completeWrite();
  await expect.poll(() => state.publications.length).toBe(1);
  await expect(page.getByRole('button', { name: 'More actions', exact: true })).toBeEnabled();
});
