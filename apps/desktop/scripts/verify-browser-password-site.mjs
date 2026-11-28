import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { connectBrowserOverlay, openBrowserDataMenuItem } from './browser-data-test-menu.mjs';

// Run only against the isolated Rust browser-data fixture; never submit the website login form.
const target = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(target.protocol)) throw new Error('An HTTP or HTTPS login URL is required');
const nativeEndpoint = 'http://127.0.0.1:9355';
const browser = await chromium.connectOverCDP(nativeEndpoint);
const page = browser.contexts()[0].pages().find(page => page.url().includes('browser-data-harness'));
if (!page) throw new Error('Isolated browser-data harness is required');
let engine, overlay;
try {
  const address = page.getByLabel('页面地址', { exact: true });
  await address.fill(target.href); await address.press('Enter');
  await expect.poll(async () => {
    try { engine = await chromium.connectOverCDP('http://127.0.0.1:9356'); return true; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  await expect.poll(() => engine.contexts()[0].pages().some(page => page.url().startsWith(target.origin))).toBe(true);
  const site = engine.contexts()[0].pages().find(page => page.url().startsWith(target.origin));
  const username = site.locator('input[autocomplete=username], input[type=text], input[type=email], input:not([type])').first();
  await expect(username).toBeVisible({ timeout: 120000 });
  await openBrowserDataMenuItem(page, '密码管理', nativeEndpoint);
  await page.getByRole('button', { name: '添加密码', exact: true }).click();
  await page.getByLabel('网站地址', { exact: true }).fill(target.origin);
  await page.getByLabel('用户名', { exact: true }).fill('remoteai-fill-test');
  await page.getByLabel('密码', { exact: true }).fill('fictional-fill-test-secret');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await page.getByRole('button', { name: '关闭 密码管理', exact: true }).click();
  await username.click();
  overlay = await connectBrowserOverlay(nativeEndpoint);
  const choices = overlay.popup.getByRole('dialog', { name: '选择要填入的账号', exact: true });
  await expect(choices).toBeVisible();
  await overlay.popup.screenshot({ path: fileURLToPath(
    new URL('../../../.codex-tmp/browser-data/pc-requested-site-suggestions.png', import.meta.url)) });
  await choices.getByRole('button', { name: /remoteai-fill-test/ }).click();
  await expect(username).toHaveValue('remoteai-fill-test');
  await expect(site.locator('input[type=password]')).toHaveValue('fictional-fill-test-secret');
  await username.fill('');
  await site.locator('input[type=password]').fill('');
  console.log('Requested login website: input suggestions and filling passed without submission');
} finally { await engine?.close(); await overlay?.connection.close(); await browser.close(); }
