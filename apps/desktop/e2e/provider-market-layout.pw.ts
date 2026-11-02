import { expect, test } from '@playwright/test';
import { expectMarketDialogLayout, fixtureItem, setupMarket } from './provider-market-support';

const names = ['模力方舟', 'YYLX', 'XycAi', 'xAI (Grok)', 'Vercel AI Gateway', 'V-API'];
const items = Array.from({ length: 40 }, (_, index) => ({ ...fixtureItem(),
  id: `provider-${index}`, name: `${names[index % names.length]} ${index + 1}`, description: '', balanceQuery: null,
}));

for (const mode of ['local', 'hosted']) {
  for (const dark of [false, true]) {
    const appearance = dark ? 'narrow dark' : 'wide light';
    test(`${mode}: ${appearance} fixed controls and frosted card feedback`, async ({ page }, info) => {
      await setupMarket(page, mode, true, async (request) => {
        const filtered = request.search ? items.filter(item => item.name === request.search) : items;
        return { items: filtered, total: filtered.length };
      });
      await page.route('https://provider.example/**', route => route.fulfill({ status: 404 }));
      await page.setViewportSize({ width: dark ? 640 : 1440, height: 900 });
      await page.goto(`/e2e/provider-market-harness.html?mode=${mode}&language=zh${dark ? '&dark=1' : ''}`);
      await page.locator('.provider-market-button').first().click();
      await expect(page.locator('.pm-card')).toHaveCount(items.length);
      await expectMarketDialogLayout(page);
      const name = `${mode}-${dark ? 'dark-narrow' : 'light-wide'}`;
      const controls = page.locator('.pm-market-controls');
      const before = await controls.boundingBox();
      const search = page.locator('.pm-search-toolbar > .ant-input-search');
      const searchBefore = await search.boundingBox();
      const publish = page.getByRole('button', { name: '发布 Provider', exact: true });
      expect((await publish.boundingBox())!.y).toBe(searchBefore!.y);
      const card = page.locator('.pm-card').first();
      const idleBorder = await card.evaluate(node => getComputedStyle(node).borderTopColor);
      await page.screenshot({ path: info.outputPath(`${name}-list.png`) });
      await card.hover();
      await expect.poll(() => card.evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe(idleBorder);
      expect(await card.evaluate(node => getComputedStyle(node).backdropFilter)).toContain('blur');
      await page.screenshot({ path: info.outputPath(`${name}-hover.png`) });
      await page.mouse.move(0, 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await card.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
      const scroll = page.locator('.pm-catalog-scroll');
      await scroll.evaluate(node => { node.scrollTop = 900; });
      expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(500);
      expect(await controls.boundingBox()).toEqual(before);
      expect(await search.boundingBox()).toEqual(searchBefore);
      expect(await scroll.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await expect(publish).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`${name}-scrolled.png`) });
      await page.getByRole('searchbox').fill(items[0].name);
      await page.getByRole('searchbox').press('Enter');
      await expect(page.locator('.pm-card')).toHaveCount(1);
      await page.getByText('我的发布', { exact: true }).click();
      await expect(page.locator('.pm-card')).toHaveCount(1);
      await card.locator('.pm-card-title').focus();
      expect(await card.evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe(idleBorder);
      await page.keyboard.press('Enter');
      await expect(page.locator('.pm-install')).toBeVisible();
    });
  }
}
