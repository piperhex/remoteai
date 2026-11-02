import { expect, test } from '@playwright/test';
import { fixtureItem, setupMarket } from './provider-market-support';

for (const mode of ['local', 'hosted']) {
  for (const dark of [false, true]) {
    test(`${mode}: homepage opens inside the app and preserves the API key (${dark ? 'dark' : 'light'})`,
      async ({ page }, info) => {
        const state = await setupMarket(page, mode);
        const item = fixtureItem();
        if (mode === 'hosted') item.pageLink!.headers = {};
        state.setItem(item);
        await page.route('https://provider.example/**', route => route.fulfill({
          contentType: 'text/html', body: '<h1>Provider homepage</h1>',
        }));
        await page.setViewportSize({ width: dark ? 900 : 1440, height: 900 });
        await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&language=zh${dark ? '&dark=1' : ''}`);
        await page.locator('.provider-market-button').first().click();
        await page.getByRole('button', { name: item.name, exact: true }).click();
        const key = page.getByLabel('填写你自己的 API Key', { exact: true });
        await key.fill('private-key-stays-in-form');
        const homepage = page.getByRole('button', { name: '前往 Provider 首页', exact: true });
        await expect(homepage).toBeVisible();
        const name = `${mode}-${dark ? 'dark-narrow' : 'light-wide'}`;
        await page.screenshot({ path: info.outputPath(`${name}-homepage-link.png`) });
        await homepage.click();
        const browser = page.getByRole('dialog', { name: 'Provider 浏览器', exact: true });
        await expect(browser).toBeVisible();
        const address = browser.getByLabel('页面地址', { exact: true });
        await expect(address).toHaveValue(
          'https://provider.example/dashboard?view=usage&source=remoteai&tag=a&tag=b#balance');
        await address.focus();
        await expect(address).toBeFocused();
        if (mode === 'local') {
          await expect.poll(() => state.browserRequests.length).toBeGreaterThan(0);
          expect(state.browserRequests.at(-1)).toMatchObject({ headers: { 'X-Source': 'RemoteAI' }, visible: true });
          expect(JSON.stringify(state.browserRequests)).not.toContain('private-key-stays-in-form');
        } else {
          await expect(browser.frameLocator('iframe').getByRole('heading', { name: 'Provider homepage' })).toBeVisible();
        }
        const beats = Number(await page.getByTestId('beats').textContent());
        await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(beats + 3);
        await page.screenshot({ path: info.outputPath(`${name}-embedded-browser.png`) });
        await address.press('Escape');
        await expect(browser).toBeHidden();
        await expect(key).toHaveValue('private-key-stays-in-form');
        await expect(homepage).toBeFocused();
        expect(state.saved).toHaveLength(0);
        expect(page.context().pages()).toHaveLength(1);
      });
  }
}

test('missing or invalid Provider pages do not show a homepage action', async ({ page }) => {
  const state = await setupMarket(page, 'hosted');
  await page.route('https://provider.example/**', route => route.fulfill({ status: 404 }));
  for (const pageLink of [null, { url: 'javascript:alert(1)', query: '', headers: {} }]) {
    state.setItem({ ...fixtureItem(), pageLink });
    await page.goto('/e2e/provider-market-harness.html?mode=hosted');
    await page.locator('.provider-market-button').first().click();
    if (pageLink) {
      await expect(page.getByRole('alert')).toContainText('The market is unavailable');
    } else {
      await page.getByRole('button', { name: 'Example Gateway', exact: true }).click();
      await expect(page.getByLabel('Enter your own API key', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Visit Provider homepage', exact: true })).toHaveCount(0);
  }
});
