import { test, expect } from '@playwright/test';
import { setupMarket } from './provider-market-support';
import { longPress } from './project-browser-touch';

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} tabs preserve pages and controls`, async ({ page }, info) => {
      if (dark) await page.setViewportSize({ width: 1024, height: 800 });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/preview-site/**', route => route.fulfill({ contentType: 'text/html', body:
        `<html><body style="font:16px system-ui;padding:30px;background:#fafbfc;color:#23372f">
        <h1>${new URL(route.request().url()).pathname.split('/').at(-1)}</h1>
        <p>Remote AI · 网页预览</p><label>备注 <input aria-label="备注"></label>
        <button onclick="this.textContent='完成'">确认</button></body></html>` }));
      await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: '使用指南' }).click();
      const browser = page.locator('.website-preview-browser');
      const frame = page.frameLocator('.pm-browser-page:not([hidden]) iframe');
      await expect(frame.getByRole('heading', { name: 'guide' })).toBeVisible();
      await frame.getByRole('textbox', { name: '备注' }).fill('保留此页内容');
      await page.getByRole('link', { name: '项目概览' }).click();
      await page.getByRole('link', { name: '帮助中心' }).click();
      await expect(browser.getByRole('tab')).toHaveCount(3);
      await expect(frame.getByRole('heading', { name: 'help' })).toBeVisible();
      await browser.getByRole('tab').first().click();
      await expect(frame.getByRole('textbox', { name: '备注' })).toHaveValue('保留此页内容');
      await page.getByRole('button', { name: '最小化详情抽屉' }).click();
      await page.getByRole('button', { name: '恢复预览', exact: true }).click();
      await expect(frame.getByRole('textbox', { name: '备注' })).toHaveValue('保留此页内容');
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-tabs.png`) });
      await browser.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(frame.getByRole('textbox', { name: '备注' })).toHaveValue('');
      await browser.getByRole('button', { name: /关闭 guide/ }).click();
      await expect(browser.getByRole('tab')).toHaveCount(2);
      await expect(frame.getByRole('heading', { name: 'dashboard' })).toBeVisible();
      await browser.getByRole('button', { name: '新标签页', exact: true }).click();
      await expect(browser.getByRole('tab')).toHaveCount(3);
      const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
      await address.fill('javascript:alert(1)'); await address.press('Enter');
      await expect(address).toHaveAttribute('aria-invalid', 'true');
      await address.fill('http://127.0.0.1:1552/preview-site/custom'); await address.press('Enter');
      await expect(frame.getByRole('heading', { name: 'custom' })).toBeVisible();
      await browser.getByRole('button', { name: '全屏展示' }).click();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark' : 'light'}-expanded.png`) });
      await browser.getByRole('button', { name: '退出全屏' }).click();
      await page.getByRole('button', { name: '切换会话', exact: true }).click();
      await expect(browser).toHaveCount(0);
    });
  }
}

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} tab close menu and adjacent add button`,
      async ({ page }, info) => {
        if (dark) await page.setViewportSize({ width: 1024, height: 800 });
        if (dark) await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
        await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
        await page.route('**/preview-site/**', route => route.fulfill({
          contentType: 'text/html', body: '<h1>Remote AI</h1>',
        }));
        await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
        await page.getByRole('link', { name: '使用指南' }).click();
        const browser = page.locator('.website-preview-browser');
        const tabs = browser.getByRole('tab');
        const add = browser.getByRole('button', { name: '新标签页', exact: true });
        const menu = page.getByRole('menu', { name: '标签页操作', exact: true });
        const assertAdjacent = async () => {
          const last = (await browser.locator('.pm-browser-tab').last().boundingBox())!;
          const button = (await add.boundingBox())!;
          expect(button.x - last.x - last.width).toBeCloseTo(6, 0);
        };
        await assertAdjacent();
        const label = `${mode}-${dark ? 'dark-narrow-font20' : 'light-wide'}`;
        await page.screenshot({ path: info.outputPath(`${label}-single-tab.png`) });
        await tabs.first().click({ button: 'right' });
        await expect(menu.getByRole('menuitem')).toHaveCount(5);
        for (const name of ['关闭左侧标签页', '关闭右侧标签页', '关闭其他标签页']) {
          await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
        }
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden(); await expect(browser).toBeVisible();
        await page.getByRole('link', { name: '项目概览' }).click();
        await page.getByRole('link', { name: '帮助中心' }).click();
        await browser.getByRole('button', { name: '全屏展示' }).click();
        await assertAdjacent();
        await tabs.nth(1).click({ button: 'right' });
        await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
        await expect(menu).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${label}-context-menu.png`), animations: 'disabled' });
        await menu.getByRole('menuitem', { name: '关闭左侧标签页', exact: true }).click();
        await expect(tabs).toHaveCount(2);
        await expect(tabs.first()).toContainText('dashboard');
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
        await expect(menu).toBeHidden();
        await longPress(page, tabs.first(), '标签页操作');
        await expect(menu.getByRole('menuitem')).toHaveCount(5);
        await page.screenshot({ path: info.outputPath(`${label}-long-press-menu.png`), animations: 'disabled' });
        await menu.getByRole('menuitem', { name: '关闭右侧标签页', exact: true }).click();
        await expect(tabs).toHaveCount(1);
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
        await add.click(); await add.click();
        await tabs.first().press('Shift+F10');
        await menu.getByRole('menuitem', { name: '关闭其他标签页', exact: true }).click();
        await expect(tabs).toHaveCount(1); await expect(tabs.first()).toContainText('dashboard');
        await add.click();
        await tabs.first().click({ button: 'right' });
        await menu.getByRole('menuitem', { name: '关闭', exact: true }).click();
        await expect(tabs).toHaveCount(1); await expect(tabs.first()).toContainText('新标签页');
        await add.click();
        await tabs.first().click({ button: 'right' });
        await menu.getByRole('menuitem', { name: '关闭全部标签页', exact: true }).click();
        await expect(browser).toHaveCount(0);
        await page.getByRole('link', { name: '使用指南' }).click();
        await expect(tabs).toHaveCount(1); await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
        await assertAdjacent();
      });
  }
}

test('Provider browser closes a batch together and keeps the window close button at the edge', async ({ page }) => {
  await setupMarket(page, 'local');
  await page.route('**/favicon.png', route => route.fulfill({ status: 204 }));
  await page.goto('/e2e/provider-market-harness.html?mode=local&browser=1&language=zh');
  await page.locator('.provider-link').filter({ hasText: 'Market Gateway' }).click();
  const browser = page.getByRole('dialog', { name: 'Provider 浏览器' });
  const add = browser.getByRole('button', { name: '新标签页', exact: true });
  const tab = (await browser.locator('.pm-browser-tab').boundingBox())!;
  const plus = (await add.boundingBox())!;
  const close = (await browser.locator('.pm-browser-close').boundingBox())!;
  const titlebar = (await browser.locator('.pm-browser-titlebar').boundingBox())!;
  expect(plus.x - tab.x - tab.width).toBeCloseTo(6, 0);
  expect(titlebar.x + titlebar.width - close.x - close.width).toBeCloseTo(10, 0);
  await add.click(); await add.click();
  await browser.getByRole('tab').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '标签页操作', exact: true });
  await menu.getByRole('menuitem', { name: '关闭其他标签页', exact: true }).click();
  await expect(browser.getByRole('tab')).toHaveCount(1);
  await expect(browser.getByRole('tab')).toHaveAttribute('aria-selected', 'true');
  await add.click();
  await browser.getByRole('tab').first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '关闭全部标签页', exact: true }).click();
  await expect(browser).toBeHidden();
});

test('tab menus switch languages and keep their resources available offline', async ({ page }, info) => {
  await setupMarket(page, 'local');
  await page.route('**/favicon.png', route => route.fulfill({ status: 204 }));
  const locales = [
    { language: 'zh', menu: '标签页操作', close: '关闭全部标签页' },
    { language: 'en', menu: 'Tab actions', close: 'Close all tabs' },
    { language: 'ja', menu: 'タブ操作', close: 'すべてのタブを閉じる' },
    { language: 'ru', menu: 'Действия с вкладкой', close: 'Закрыть все вкладки' },
    { language: 'unsupported', menu: 'Tab actions', close: 'Close all tabs' },
  ];
  for (const locale of locales) {
    await page.goto(`/e2e/provider-market-harness.html?mode=local&browser=1&language=${locale.language}`);
    await page.locator('.provider-link').filter({ hasText: 'Market Gateway' }).click();
    await page.context().setOffline(true);
    await page.locator('.pm-browser').getByRole('tab').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: locale.menu, exact: true });
    await expect(menu.getByRole('menuitem')).toHaveCount(5);
    await expect(menu.getByRole('menuitem', { name: locale.close, exact: true })).toBeVisible();
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: info.outputPath(`provider-${locale.language}-offline-menu.png`) });
    await page.context().setOffline(false);
  }
});

test('Provider browser uses the same overflow menu', async ({ page }, info) => {
  await setupMarket(page, 'local');
  await page.route('**/favicon.png', route => route.fulfill({ status: 204 }));
  await page.goto('/e2e/provider-market-harness.html?mode=local&browser=1&language=zh',
    { waitUntil: 'domcontentloaded' });
  await page.locator('.provider-link').filter({ hasText: 'Market Gateway' }).click();
  const browser = page.getByRole('dialog', { name: 'Provider 浏览器' });
  for (let index = 0; index < 10; index++) await browser.getByRole('button', { name: '新标签页', exact: true }).click();
  await expect(browser.locator('.pm-browser-tabs-bar')).toHaveAttribute('data-clipped-left', 'true');
  await browser.getByRole('button', { name: '更多标签页', exact: true }).click();
  const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: info.outputPath('provider-local-light-overflow-menu.png') });
  await menu.getByRole('menuitem').filter({ hasText: 'Market Gateway' }).click();
  await expect(browser.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} overflowing tabs slide left and offer a hidden-tab menu`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.route('**/preview-site/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Preview</h1>' }));
    await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}&dark=1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '使用指南' }).click();
    const browser = page.locator('.website-preview-browser');
    for (let index = 0; index < 7; index++) {
      await browser.getByRole('button', { name: '新标签页', exact: true }).click();
      const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
      await address.fill(`http://127.0.0.1:1552/preview-site/long-page-title-${index}`); await address.press('Enter');
    }
    const strip = browser.locator('.pm-browser-tabs');
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect(browser.locator('.pm-browser-tabs-bar')).toHaveAttribute('data-clipped-left', 'true');
    expect(await strip.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    const more = browser.getByRole('button', { name: '更多标签页', exact: true });
    await more.click();
    const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem').first().hover();
    await page.screenshot({ path: info.outputPath(`${mode}-dark-overflow-menu.png`), animations: 'disabled' });
    await menu.getByRole('menuitem').filter({ hasText: 'guide' }).click();
    await expect(browser.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBe(0);
    await browser.getByRole('tab').first().press('End');
    await expect(browser.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
    await more.click();
    await menu.getByRole('button', { name: /关闭 guide/ }).click();
    await expect(browser.getByRole('tab')).toHaveCount(7);
    await more.click(); await page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect(browser).toBeVisible();
  });
}
