import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

// Run after building codex_switch_lib_tests, with Vite's website-tabs harness on port 1552.
const executable = process.argv[2];
if (!executable) throw new Error('Pass the codex_switch_lib_tests executable path.');
const expect = baseExpect.configure({ timeout: 15_000 });
let slow = true;
const resources = new Set();
let continueCapture;
const server = http.createServer((request, response) => {
  if (request.url === '/continue') {
    continueCapture?.(); response.end('ok'); return;
  }
  if (request.url === '/loading-resource' && slow) {
    resources.add(response); response.on('close', () => resources.delete(response)); return;
  }
  if (request.url === '/preview-site/pending') {
    resources.add(response); response.on('close', () => resources.delete(response)); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>Remote AI</title></head><body '
    + 'style="font:16px system-ui;padding:32px;background:#fafbfc;color:#23372f">'
    + '<h1>Browser preview</h1><p>Remote AI</p><img src="/loading-resource" alt=""></body></html>');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(1555, '127.0.0.1', resolve); });
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit' });
let browser;
const capture = async state => {
  console.log(`Native ${state}: ready for screenshot.`);
  if (['1', state].includes(process.env.BROWSER_LOADING_PAUSE)) {
    await new Promise(resolve => { continueCapture = resolve; });
    continueCapture = undefined;
  }
};
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9333/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const context = browser.contexts()[0];
  let page;
  await expect.poll(() => {
    page = context.pages().find(entry => entry.url().includes('website-tabs-harness')); return Boolean(page);
  }).toBe(true);
  const request = value => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }),
    { threadId: 'preview-thread', ...value });
  page.on('console', message => console.log('Native console:', message.text()));
  page.on('pageerror', error => console.log('Native page error:', error.message));
  const chrome = page.locator('.website-preview-browser');
  const stop = chrome.getByRole('button', { name: '取消', exact: true });
  const reload = chrome.getByRole('button', { name: '刷新', exact: true });
  await page.getByRole('link', { name: '使用指南' }).click();
  const address = chrome.getByRole('textbox', { name: '页面地址', exact: true });
  await address.fill('http://127.0.0.1:1555/preview-site/guide'); await address.press('Enter');
  await expect.poll(() => resources.size).toBe(1);
  await expect(stop).toBeVisible();
  await capture('loading');
  await stop.click();
  await expect(reload).toBeVisible();
  await expect.poll(() => resources.size).toBe(0);
  await capture('stopped');
  slow = false;
  const nativePage = context.pages().find(entry => entry.url().includes('1555/preview-site/guide'));
  const loaded = nativePage.waitForEvent('load');
  await reload.click();
  await loaded;
  await expect(reload).toBeVisible();
  await address.fill('http://127.0.0.1:1555/preview-site/pending'); await address.press('Enter');
  await expect.poll(() => resources.size).toBe(1);
  await expect(stop).toBeVisible(); await stop.click(); await expect(reload).toBeVisible();
  await expect.poll(() => resources.size).toBe(0);
  slow = true;
  const opened = await request({ command: { action: 'open', url: 'http://127.0.0.1:1555/preview-site/managed',
    requestId: 'loading-native' } });
  await expect.poll(() => resources.size).toBe(1);
  await expect(stop).toBeVisible();
  await capture('managed-loading');
  await stop.click();
  await expect(reload).toBeVisible();
  await expect.poll(async () => (await request({ command: { action: 'list' } })).tabs
    .find(tab => tab.id === opened.tab.id)?.loading).toBe(false);
  await expect.poll(() => resources.size).toBe(0);
  await verifyRemotePreviews({ request, resources });
  console.log('Native stop cancels active resources and pending navigation; managed tab loading settles.');
} finally {
  await browser?.close();
  native.kill();
  for (const resource of resources) resource.destroy();
  server.closeAllConnections(); server.close();
}

async function verifyRemotePreviews({ request, resources }) {
  const output = new URL('../../../.codex-tmp/browser-loading-native/', import.meta.url);
  await mkdir(output, { recursive: true });
  const remote = await chromium.launch(testBrowserLaunchOptions());
  try {
    for (const mode of ['remote', 'web']) {
      const page = await remote.newPage({ viewport: { width: mode === 'remote' ? 1440 : 1024, height: 900 } });
      await page.route('http://127.0.0.1:1554/request', async route => {
        const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1552',
          'Access-Control-Allow-Headers': 'Content-Type' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        await route.fulfill({ headers, json: await request(route.request().postDataJSON()) });
      });
      await page.goto(`http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=${mode}&automation=1&dark=1`);
      const chrome = page.locator('.website-preview-browser');
      const reload = chrome.getByRole('button', { name: '刷新', exact: true });
      const stop = chrome.getByRole('button', { name: '取消', exact: true });
      await expect(chrome.locator('.website-browser-stream')).toBeVisible();
      await reload.click();
      await expect.poll(() => resources.size).toBe(1);
      await expect(stop).toBeVisible();
      await page.screenshot({ path: fileURLToPath(new URL(`${mode}-dark-loading.png`, output)) });
      await stop.click();
      await expect(reload).toBeVisible();
      await expect.poll(() => resources.size).toBe(0);
      await page.screenshot({ path: fileURLToPath(new URL(`${mode}-dark-stopped.png`, output)) });
      await page.close();
    }
  } finally { await remote.close(); }
}
