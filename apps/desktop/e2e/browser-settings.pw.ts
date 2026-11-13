import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web']) for (const enlarged of [false, true]) {
  test(`${mode} search engine ${enlarged ? 'dark enlarged narrow' : 'light default wide'}`, async ({ page }, info) => {
    await page.setViewportSize({ width: enlarged ? 1000 : 1440, height: 900 });
    await page.route(/^https:\/\/(www\.google\.com|www\.baidu\.com|www\.bing\.com|duckduckgo\.com)/,
      route => route.fulfill({ contentType: 'text/html', body: '<h1>Search result fixture</h1>' }));
    const entry = `/e2e/browser-bookmarks-harness.html?mode=${mode}${enlarged ? '&dark=1&font=20' : ''}`;
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    const browser = page.locator('.pm-browser');
    const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
    const settings = browser.getByRole('button', { name: '浏览器设置', exact: true });
    await address.fill('默认搜索 测试'); await address.press('Enter');
    await expect(address).toHaveValue('https://www.google.com/search?q=%E9%BB%98%E8%AE%A4%E6%90%9C%E7%B4%A2+%E6%B5%8B%E8%AF%95');
    await expect(browser.locator('iframe').contentFrame().getByRole('heading')).toHaveText('Search result fixture');
    await settings.click();
    const quickAdd = page.locator('.browser-bookmark-settings-popup').getByRole('button', { name: '添加书签', exact: true });
    await quickAdd.click(); await expect(quickAdd).toBeDisabled();
    await expect(page.getByRole('dialog', { name: '添加书签' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-quick-bookmark.png`),
      animations: 'disabled' });
    await settings.click();
    for (const [name, engine, host] of [['百度', 'baidu', 'www.baidu.com'], ['必应', 'bing', 'www.bing.com'],
      ['DuckDuckGo', 'duckduckgo', 'duckduckgo.com']]) {
      await settings.click();
      await page.locator('.browser-bookmark-settings-popup .ant-select-selector').click();
      if (engine === 'baidu') await page.screenshot({
        path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-options.png`), animations: 'disabled',
      });
      await page.getByTitle(name, { exact: true }).last().click();
      await expect(page.locator('.browser-bookmark-settings-popup .ant-select-dropdown:visible')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('remoteai:browser-search-engine'))).toBe(engine);
      await page.screenshot({ path: info.outputPath(`${mode}-${enlarged ? 'dark-20px' : 'light-14px'}-${engine}.png`),
        animations: 'disabled' });
      await settings.click();
      await address.fill('ports & 中文'); await address.press('Enter');
      const url = new URL(await address.inputValue());
      expect(url.hostname).toBe(host);
      expect(url.searchParams.get(engine === 'baidu' ? 'wd' : 'q')).toBe('ports & 中文');
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await settings.click();
    await expect(page.locator('.browser-bookmark-settings-popup')).toContainText('DuckDuckGo');
    await settings.click();
    await address.fill('http://127.0.0.1:18306'); await address.press('Enter');
    await expect(address).toHaveValue('http://127.0.0.1:18306/');
  });
}
