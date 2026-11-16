// Run with the browser extensions Vite harness on 1582 and a freshly compiled Rust test executable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const executable = process.env.BROWSER_EXTENSION_TEST_EXE;
if (!executable) throw new Error('Set BROWSER_EXTENSION_TEST_EXE to the compiled Rust test executable.');
const output = fileURLToPath(new URL('../../../.codex-tmp/browser-extension-market-network/', import.meta.url));
await mkdir(output, { recursive: true });
const bytes = Buffer.from([80, 75, 3, 4]);
const item = { id: '12345678-1234-4234-8234-123456789abc', name: 'Marketplace network verification',
  description: 'Public extension catalog', version: '1.0', permissions: [], size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };
let fail = false, empty = false;
const requests = [];
const fixture = createServer((request, response) => {
  requests.push({ path: request.url, credentials: !!(request.headers.authorization || request.headers.cookie) });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (fail) { response.writeHead(503); response.end(); return; }
  if (request.url === '/browser-extensions') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ items: empty ? [] : [item] })); return;
  }
  if (request.url === `/browser-extensions/${item.id}/archive?sha256=${item.sha256}`) {
    response.end(bytes); return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolve => fixture.listen(1594, '127.0.0.1', resolve));
const base = 'http://localhost:1594'; // Deliberately outside packaged connect-src's 127.0.0.1 exception.
let child, engine, browser, native;
const results = [];
async function openMarket(page, query) {
  await page.goto(`http://127.0.0.1:1582/e2e/browser-extensions-harness.html?market=${base}&${query}`);
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: '管理扩展程序', exact: true }).click();
  await page.getByText('插件市场', { exact: true }).click();
}
async function screenshot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ animations: 'disabled', path: `${output}/${name}.png` });
}
try {
  child = spawn(executable, ['provider_browser::extensions::smoke::opens_extension_browser',
    '--ignored', '--exact', '--nocapture', '--test-threads=1'], { windowsHide: true, stdio: 'pipe' });
  child.stderr.on('data', data => process.stderr.write(data));
  await expect.poll(async () => {
    try { engine = await chromium.connectOverCDP('http://127.0.0.1:9365'); return true; }
    catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => {
    native = engine.contexts()[0].pages().find(page => page.url().includes('browser-extensions-harness'));
    return !!native;
  }, { timeout: 30_000 }).toBe(true);
  browser = await chromium.launch(testBrowserLaunchOptions());
  for (const mode of ['local', 'remote', 'web']) {
    const page = mode === 'web' ? await browser.newPage() : native;
    for (const entry of ['standalone', 'agentHub']) {
      await page.setViewportSize({ width: 1380, height: 900 });
      const query = `mode=${mode}&entry=${entry}${mode === 'web' ? '' : '&native=1&marketPolicy=1'}`;
      empty = false;
      await openMarket(page, query);
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
      if (mode !== 'web') {
        const blocked = await page.evaluate(async url => {
          try { await fetch(url); return false; } catch { return true; }
        }, `${base}/browser-extensions`);
        assert.equal(blocked, true, 'The regression must run under the packaged network policy');
      }
      await screenshot(page, `windows-${mode}-${entry}-light-loaded`);
      empty = true;
      await page.locator('.browser-extension-market').getByRole('button', { name: '刷新列表' }).click();
      await expect(page.locator('.browser-extension-market .ant-empty')).toBeVisible();
      await expect(page.locator('.browser-extension-market .ant-alert')).toHaveCount(0);
      await screenshot(page, `windows-${mode}-${entry}-light-empty`);
      fail = true;
      await page.locator('.browser-extension-market').getByRole('button', { name: '刷新列表' }).click();
      await expect(page.getByText('插件市场加载失败，请重试。')).toBeVisible();
      fail = false; empty = false;
      await page.locator('.browser-extension-market').getByRole('button', { name: '刷新列表' }).click();
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
      await expect(page.locator('.browser-extension-market .ant-alert')).toHaveCount(0);
      await page.setViewportSize({ width: 960, height: 900 });
      await openMarket(page, `${query}&dark=1&font=20`);
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
      await screenshot(page, `windows-${mode}-${entry}-dark-narrow-loaded`);
      results.push({ mode, entry, catalog: true, empty: true, retry: true, packagedCsp: mode !== 'web' });
    }
    if (mode === 'web') await page.close();
  }
  const encoded = await native.evaluate(async ({ baseUrl, archive }) =>
    window.__TAURI_INTERNALS__.invoke('fetch_browser_extension_market', { baseUrl, archive }),
  { baseUrl: base, archive: { id: item.id, sha256: item.sha256, size: item.size } });
  assert.deepEqual(Buffer.from(encoded, 'base64'), bytes);
  assert.equal(requests.some(request => request.credentials), false);
  await native.goto('http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=local&native=1&marketPolicy=1'
    + '&market=https://codex.onepiper.cloud');
  await native.getByRole('button', { name: '扩展程序', exact: true }).click();
  await native.getByRole('button', { name: '管理扩展程序', exact: true }).click();
  await native.getByText('插件市场', { exact: true }).click();
  await expect(native.locator('.browser-extension-market .ant-empty')).toBeVisible({ timeout: 30_000 });
  await expect(native.locator('.browser-extension-market .ant-alert')).toHaveCount(0);
  await screenshot(native, 'windows-local-production-empty');
  await writeFile(`${output}/results.json`, JSON.stringify({ results, nativeArchive: true,
    productionEmpty: true, requests }, null, 2));
  console.log('Marketplace CSP, catalog, empty state, retry and archive checks passed across local/remote/Web.');
} finally {
  await browser?.close(); await engine?.close();
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped;
  }
  fixture.closeAllConnections(); fixture.close();
}
