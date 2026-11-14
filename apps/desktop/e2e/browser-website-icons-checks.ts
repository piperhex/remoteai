import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';

const icon = readFileSync(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const chatgptIcon = 'https://chatgpt.com/cdn/assets/favicon-48x48.7d42b2e65f.png';
// Public favicon from chatgptIcon; keep screenshots recognizable without depending on external network access.
const chatgptImage = readFileSync(new URL('./fixtures/chatgpt-favicon.png', import.meta.url));

export async function verifyWebsiteIcons(options: {
  page: Page; info: TestInfo; harness: string; scope: string; label: string;
}) {
  const { page, info, harness, scope, label } = options;
  await page.route('**/favicon.*', route => route.fulfill({ status: 404 }));
  await page.route('**/icon-site/assets/logo.png', route => route.fulfill({ contentType: 'image/png', body: icon }));
  await page.route(chatgptIcon, route => route.fulfill({ contentType: 'image/png', body: chatgptImage }));
  await page.route('**/icon-site/page', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><base href="/icon-site/"><link rel="icon" href="assets/logo.png">'
    + '<title>Website icon fixture</title></head><body><h1>Website icon fixture</h1></body></html>' }));
  await page.addInitScript(scope => {
    localStorage.setItem(`remoteai:browser-bookmarks:${scope}`, JSON.stringify({ document: { revision: 0, entries: [
      { id: 'chatgpt', kind: 'link', title: 'ChatGPT', url: 'https://chatgpt.com/', parentId: '', position: 0 },
      { id: 'page', kind: 'link', title: 'Website icon fixture', url: `${location.origin}/icon-site/page`,
        parentId: '', position: 1 },
      { id: 'missing', kind: 'link', title: 'Missing icon', url: 'https://missing.example.test/',
        parentId: '', position: 2 },
    ] } }));
  }, scope);
  await page.goto(harness, { waitUntil: 'domcontentloaded' });
  const browser = page.locator('.browser-main-page');
  const chatgpt = browser.locator('[data-bookmark-id="chatgpt"] img');
  await expect(chatgpt).toHaveAttribute('src', chatgptIcon);
  await expect(chatgpt).toHaveAttribute('data-loaded', 'true');
  await expect(browser.locator('[data-bookmark-id="missing"] .lucide-globe')).toBeVisible();
  await expect(browser.locator('[data-bookmark-id="missing"] .lucide-server')).toHaveCount(0);
  const bookmark = browser.locator('[data-bookmark-id="page"]');
  await bookmark.click();
  const url = new URL('/icon-site/assets/logo.png', page.url()).href;
  for (const image of [browser.getByRole('tab').locator('img'), browser.locator('.pm-browser-toolbar img'),
    bookmark.locator('img')]) {
    await expect(image).toHaveAttribute('src', url);
    await expect(image).toHaveAttribute('data-loaded', 'true');
  }
  await page.screenshot({ path: info.outputPath(`${label}-discovered-icons.png`) });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(bookmark.locator('img')).toHaveAttribute('src', url);
  await expect(bookmark.locator('img')).toHaveAttribute('data-loaded', 'true');
  await browser.getByRole('button', { name: '浏览器设置', exact: true }).click();
  await page.locator('.browser-bookmark-settings-popup').getByRole('button', { name: '所有书签', exact: true }).hover();
  const menu = page.getByRole('menu', { name: '所有书签', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Website icon fixture', exact: true }).locator('img'))
    .toHaveAttribute('data-loaded', 'true');
  await menu.getByRole('menuitem', { name: '管理书签', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '管理书签', exact: true });
  await expect(manager.locator('.browser-bookmark-row').filter({ hasText: 'Website icon fixture' }).locator('img'))
    .toHaveAttribute('src', url);
  await expect(manager.locator('.browser-bookmark-row').filter({ hasText: 'Missing icon' }).locator('.lucide-globe'))
    .toBeVisible();
  await expect(page.locator('.ant-modal:visible')).not.toHaveClass(/-appear|-enter/);
  await page.screenshot({ path: info.outputPath(`${label}-bookmark-manager.png`) });
}
