import { expect, test } from '@playwright/test';

for (const width of [1440, 900]) test(`retains account tables and charts across navigation at ${width}px`,
  async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('codex-switch:language', 'en');
      localStorage.setItem('codex-switch:navigation-style', 'sidebar');
      localStorage.setItem('codex-switch:providers', JSON.stringify([{
        id: 'retained-provider', name: 'Test provider', kind: 'custom', group: '',
        baseUrl: 'https://example.test/v1', model: 'gpt-5', models: ['gpt-5'], apiFormat: 'openaiResponses',
      }]));
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const navigation = page.locator('.sidebar-tabs');
    await navigation.getByRole('button', { name: 'Accounts', exact: true }).click();
    await expect(page.locator('.announcement-slot')).toBeVisible();
    await navigation.getByRole('button', { name: 'Browser', exact: true }).click();
    await expect(page.locator('.announcement-slot')).toHaveCount(0);
    await expect(page.locator('.app-menu')).toBeHidden();
    const browser = page.locator('.browser-main-page');
    await expect(browser).toBeVisible();
    const titlebarBounds = (await page.locator('.window-titlebar').boundingBox())!;
    expect((await browser.boundingBox())!.y).toBeCloseTo(titlebarBounds.y + titlebarBounds.height, 0);
    await page.screenshot({ path: info.outputPath(`desktop-browser-no-announcement-${width}.png`) });
    await navigation.getByRole('button', { name: 'Accounts', exact: true }).click();
    await expect(page.locator('.announcement-slot')).toBeVisible();
    const accountBody = page.locator('#account-panel-accounts .ant-table-body');
    await expect(accountBody).toBeVisible();
    const accountNode = await accountBody.elementHandle();
    await accountBody.evaluate(node => { node.scrollLeft = 100; });
    const scroll = await accountBody.evaluate(node => node.scrollLeft);
    await page.locator('#account-section-providers').click();
    const providerBody = page.locator('#account-panel-providers .ant-table-body');
    await expect(providerBody).toBeVisible();
    const providerNode = await providerBody.elementHandle();
    await page.screenshot({ path: info.outputPath(`desktop-preview-providers-${width}.png`) });
    await page.locator('#account-section-claudeCode').click();
    await page.locator('#account-section-providers').click();
    expect(await providerNode?.evaluate(node => node.isConnected)).toBe(true);
    const timings = [];
    for (let index = 0; index < 8; index++) {
      const selector = index % 2 ? '#account-section-providers' : '#account-section-accounts';
      timings.push(await page.locator(selector).evaluate(async node => {
        const start = performance.now(); (node as HTMLElement).click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - start;
      }));
    }
    await page.locator('#account-section-accounts').click();
    expect(await accountNode?.evaluate(node => node.isConnected)).toBe(true);
    expect(await accountBody.evaluate(node => node.scrollLeft)).toBe(scroll);
    await page.screenshot({ path: info.outputPath(`desktop-preview-accounts-${width}.png`) });
    await navigation.getByRole('button', { name: /^Token/ }).click();
    const chart = page.locator('.token-dashboard-page [_echarts_instance_]').first();
    await expect(chart.locator('canvas').first()).toBeVisible();
    const chartNode = await chart.elementHandle();
    const instance = await chart.getAttribute('_echarts_instance_');
    await navigation.getByRole('button', { name: 'Accounts', exact: true }).click();
    await expect(chart).toBeHidden();
    expect(await chartNode?.evaluate(node => node.isConnected)).toBe(true);
    await navigation.getByRole('button', { name: /^Token/ }).click();
    await expect(chart).toBeVisible();
    expect(await chart.evaluate((node, retained) => node === retained, chartNode)).toBe(true);
    await expect(chart).toHaveAttribute('_echarts_instance_', instance!);
    await page.screenshot({ path: info.outputPath(`desktop-preview-token-return-${width}.png`) });
    await info.attach('navigation-timings-ms', { body: JSON.stringify(timings), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
