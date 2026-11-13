import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
const expect = baseExpect.configure({ timeout: 30_000 });
if (!executable) throw new Error('Pass the codex_switch_lib_tests executable path; run Vite on port 1552 first.');
const output = new URL('../../../.codex-tmp/browser-main-native/', import.meta.url);
await mkdir(output, { recursive: true });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<h1>Mapped website</h1><input aria-label="draft" value="original">');
});
await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(18306, '127.0.0.1', resolve);
});
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit', env: { ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
let page;
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9333/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const context = browser.contexts()[0];
  await expect.poll(() => {
    page = context.pages().find(entry => entry.url().includes('website-tabs-harness')); return Boolean(page);
  }).toBe(true);
  page.on('pageerror', error => console.error('Native page error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Native console:', message.text()); });
  for (const mode of ['local', 'remote']) for (const enlarged of [false, true]) {
    await page.setViewportSize({ width: enlarged ? 900 : 1440, height: 900 });
    await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}&mapping=1`
      + (enlarged ? '&dark=1&font=20' : ''));
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (...args) => {
        try { return await original(...args); }
        catch (error) { console.error('Native command failed:', args[0], String(error)); throw error; }
      };
    });
    const chrome = page.locator('.browser-main-page');
    const address = chrome.getByRole('textbox', { name: '页面地址', exact: true });
    await address.fill('http://127.0.0.1:18306/?native-child=1');
    await address.press('Enter');
    await expect.poll(() => context.pages().some(entry => entry.url().includes('native-child=1'))).toBe(true);
    const child = context.pages().find(entry => entry.url().includes('native-child=1'));
    await expect(child.getByRole('heading')).toHaveText('Mapped website');
    await child.getByRole('textbox', { name: 'draft' }).fill('retained');
    await chrome.getByRole('button', { name: '浏览器设置', exact: true }).click();
    const menu = page.locator('.browser-bookmark-settings-popup');
    await expect(menu.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: '在浏览器中打开', exact: true })).toBeEnabled();
    await expect(menu.getByRole('checkbox', { name: '桌面版网站', exact: true })).toBeChecked();
    const prefix = `windows-${mode}-${enlarged ? 'dark-20px-narrow' : 'light-14px'}`;
    await page.screenshot({ path: fileURLToPath(new URL(`${prefix}-settings.png`, output)), animations: 'disabled' });
    await menu.getByRole('button', { name: '端口映射', exact: true }).click();
    const mappings = page.getByRole('dialog', { name: '端口映射', exact: true });
    await expect(mappings.locator('.browser-port-mappings button')).toHaveCount(1);
    await page.screenshot({ path: fileURLToPath(new URL(`${prefix}-mappings.png`, output)), animations: 'disabled' });
    await mappings.getByRole('button', { name: 'Close', exact: true }).click();
    await chrome.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await expect(menu.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    await chrome.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await page.locator('nav').getByRole('button', { name: 'Coze', exact: true }).click();
    await expect(chrome).toBeHidden();
    await page.locator('nav').getByRole('button', { name: '浏览器', exact: true }).click();
    await expect(chrome).toBeVisible();
    await expect.poll(() => context.pages().includes(child)).toBe(true);
    await expect(child.getByRole('textbox', { name: 'draft' })).toHaveValue('retained');
  }
  await page.setViewportSize({ width: 560, height: 900 });
  await page.locator('.browser-main-page').getByRole('button', { name: '浏览器设置', exact: true }).click();
  await expect(page.locator('.browser-bookmark-settings-popup').getByRole('button', { name: '关闭', exact: true }))
    .toHaveCount(0);
  console.log('Native browser navigation, retained tabs, settings and mapping dialogs verified in both modes.');
} catch (error) {
  if (page) {
    console.error('Native browser feedback:', await page.locator('.pm-browser-feedback').allTextContents());
    console.error('Native targets:', browser.contexts()[0].pages().map(entry => entry.url()));
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) });
  }
  throw error;
} finally {
  await browser?.close(); native.kill(); server.closeAllConnections(); server.close();
}
