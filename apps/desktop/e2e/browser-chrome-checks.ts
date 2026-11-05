import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

const icon = readFileSync(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const site = 'https://docs.example.test/preview-site/guide?view=usage#intro';
const background = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).backgroundColor);

export async function prepareBrowserChrome(page: Page) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/favicon.*', route => {
    const url = new URL(route.request().url());
    const missing = url.hostname === 'missing.example.test'
      || (url.hostname === 'docs.example.test' && url.pathname.endsWith('.ico'));
    return route.fulfill(missing ? { status: 404 } : { contentType: 'image/png', body: icon });
  });
  await page.route('**/preview-site/**', route => route.fulfill({ contentType: 'text/html', body:
    '<body style="font:16px system-ui;padding:30px;background:#fafbfc;color:#23372f">'
    + '<h1>Remote AI</h1><p>Browser preview</p></body>',
  }));
}

async function verifyHover(page: Page, browser: Locator, info: TestInfo, label: string) {
  const tabs = browser.locator('.pm-browser-tab');
  const inactive = tabs.first();
  const active = tabs.last();
  const selectedBackground = await background(active);
  const defaultBackground = await background(inactive);
  await inactive.getByRole('tab').hover();
  expect(await background(inactive)).not.toBe(defaultBackground);
  expect(await background(inactive.getByRole('tab'))).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath(`${label}-inactive-hover.png`) });
  await inactive.locator('button').last().hover();
  expect(await background(inactive.locator('button').last())).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath(`${label}-inactive-close-hover.png`) });
  await active.getByRole('tab').hover();
  expect(await background(active)).toBe(selectedBackground);
  expect(await background(active.getByRole('tab'))).toBe('rgba(0, 0, 0, 0)');
  await active.locator('button').last().hover();
  expect(await background(active)).toBe(selectedBackground);
  expect(await background(active.locator('button').last())).not.toBe('rgba(0, 0, 0, 0)');
  expect(await active.locator('button').last().evaluate(element => getComputedStyle(element).borderRadius)).toBe('50%');
  await page.screenshot({ path: info.outputPath(`${label}-active-close-hover.png`) });
}

async function verifyNavigation(browser: Locator) {
  const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
  await browser.getByRole('button', { name: '新标签页', exact: true }).click();
  await expect(browser.getByRole('tab').last().locator('img')).toHaveCount(0);
  await expect(browser.locator('.pm-browser-toolbar .lucide-globe')).toBeVisible();
  await address.fill(site.replace('https://', '')); await address.press('Enter');
  await expect(address).toHaveValue(site);
  const selectedIcon = browser.getByRole('tab').last().locator('img');
  await expect(selectedIcon).toHaveAttribute('src', 'https://docs.example.test/favicon.png');
  await expect(selectedIcon).toHaveAttribute('data-loaded', 'true');
  await expect(browser.locator('.pm-browser-toolbar img')).toHaveAttribute('data-loaded', 'true');
  await expect(browser.locator('.pm-browser-page:not([hidden]) iframe')).toHaveAttribute('src', site);
  await address.fill('javascript:alert(1)'); await address.press('Enter');
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(selectedIcon).toHaveAttribute('src', 'https://docs.example.test/favicon.png');
  await address.fill(site); await address.press('Enter');
  await expect(address).toHaveAttribute('aria-invalid', 'false');
}

async function verifyFallbackAndOverflow(page: Page, browser: Locator, info: TestInfo, label: string) {
  const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
  await address.fill('missing.example.test/preview-site/page'); await address.press('Enter');
  await expect(browser.getByRole('tab').last().locator('img')).toHaveCount(0);
  await expect(browser.getByRole('tab').last().locator('.lucide-globe')).toBeVisible();
  await expect(browser.locator('.pm-browser-toolbar img')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`${label}-missing-icon.png`) });
  await browser.getByRole('button', { name: '后退', exact: true }).click();
  await expect(address).toHaveValue(site);
  await expect(browser.getByRole('tab').last().locator('img')).toHaveAttribute('data-loaded', 'true');
  for (let index = 0; index < 7; index++) {
    await browser.getByRole('button', { name: '新标签页', exact: true }).click();
  }
  await browser.getByRole('button', { name: '更多标签页', exact: true }).click();
  const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
  const menuIcon = menu.locator('img').first();
  await expect(menuIcon).toHaveAttribute('data-loaded', 'true');
  await expect.poll(async () => (await menuIcon.boundingBox())?.width).toBe(14);
  await page.screenshot({ path: info.outputPath(`${label}-overflow-icons.png`) });
}

export async function verifyBrowserChrome(options: { page: Page; info: TestInfo; label: string }) {
  const { page, info, label } = options;
  await page.getByRole('link', { name: '使用指南' }).click();
  const browser = page.locator('.website-preview-browser');
  await expect(browser.getByRole('tab').locator('img')).toHaveAttribute('data-loaded', 'true');
  await verifyNavigation(browser);
  await verifyHover(page, browser, info, label);
  await verifyFallbackAndOverflow(page, browser, info, label);
}
