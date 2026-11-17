import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import os from 'node:os';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the compiled native test executable; start Vite on 1552.');
const output = new URL('../../../.codex-tmp/browser-downloads/', import.meta.url);
await mkdir(output, { recursive: true });
const address = Object.values(os.networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
if (!address) throw new Error('A LAN address is required to verify insecure blob downloads.');
const origin = `http://${address}:18329`;
const size = 8 * 1024 * 1024;
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/slow')) {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size,
      'Content-Disposition': 'attachment; filename="sample.bin"', 'Accept-Ranges': 'bytes' });
    let sent = 0;
    const timer = setInterval(() => {
      response.write(Buffer.alloc(128 * 1024, 7)); sent += 128 * 1024;
      if (sent >= size) { clearInterval(timer); response.end(); }
    }, 100);
    response.on('close', () => clearInterval(timer));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body><h1>Browser download fixture</h1>
    <button id="blob" onclick="downloadBlob()">Blob APK</button><a href="/slow">HTTP file</a>
    <a href="data:text/plain,ordinary-download" download="ordinary.txt">Ordinary file</a>
    <script>function downloadBlob(){const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([new Uint8Array(262144).fill(42)]));a.download='zcMobile.apk';a.click();}</script>
    </body></html>`);
});
await new Promise(resolve => server.listen(18329, '0.0.0.0', resolve));
const native = spawn(executable, ['provider_browser::downloads::smoke::browser_download_fixture', '--ignored', '--nocapture'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let log = ''; native.stdout.on('data', chunk => { log += chunk; }); native.stderr.on('data', chunk => { log += chunk; });
const expect = baseExpect.configure({ timeout: 25_000 });
let browser, children;
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9371/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9371', { noDefaults: true });
  await expect.poll(() => browser.contexts()[0].pages()
    .some(page => page.url().includes('browser-downloads-harness'))).toBe(true);
  const page = browser.contexts()[0].pages().find(page => page.url().includes('browser-downloads-harness'));
  page.on('console', message => { if (message.type() === 'error') log += `\nconsole: ${message.text()}`; });
  page.on('pageerror', error => { log += `\npageerror: ${error.message}`; });
  const scenarios = ['local', 'remote', 'local-dark-20px', 'remote-dark-20px'];
  for (const scenario of scenarios) {
    const mode = scenario.startsWith('local') ? 'local' : 'remote';
    const enlarged = scenario.includes('dark');
    if (scenario !== 'local') {
      await children?.close(); children = undefined;
      await page.goto(`http://127.0.0.1:1552/e2e/browser-downloads-harness.html?mode=${mode}${enlarged ? '&dark&font=20' : ''}`);
    }
    await page.evaluate(enlarged => window.__TAURI_INTERNALS__.invoke('fixture_size',
      { width: enlarged ? 980 : 1200, height: 800 }), enlarged);
    await page.getByLabel('页面地址', { exact: true }).waitFor();
    await page.evaluate(() => window.clearBrowserDownloadFixture());
    await page.getByLabel('页面地址', { exact: true }).fill(origin);
    await page.getByLabel('页面地址', { exact: true }).press('Enter');
    if (!children) {
      await expect.poll(async () => {
        try { return (await fetch('http://127.0.0.1:9372/json/version')).ok; } catch { return false; }
      }).toBe(true);
      // Keep WebView2's real download delegate; Playwright's default download override bypasses it.
      children = await chromium.connectOverCDP('http://127.0.0.1:9372', { noDefaults: true });
    }
    await expect.poll(() => children.contexts().flatMap(context => context.pages())
      .some(child => child.url().startsWith(origin))).toBe(true);
    const child = children.contexts().flatMap(context => context.pages()).filter(child => child.url().startsWith(origin)).at(-1);
    child.on('console', message => { log += `\nchild: ${message.type()}: ${message.text()}`; });
    await child.getByRole('button', { name: 'Blob APK' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_downloads')))
      .filter(task => task.awaitingConfirmation).length).toBe(1);
    await page.getByRole('button', { name: '下载管理', exact: true }).click();
    const card = page.getByRole('article', { name: 'zcMobile.apk', exact: true }).last();
    await expect(card).toContainText('已阻止不安全的下载');
    await page.screenshot({ path: fileURLToPath(new URL(`windows-${scenario}-blocked.png`, output)) });
    await card.getByRole('button', { name: '保留', exact: true }).click();
    await expect(card).toContainText('已完成');
    await page.screenshot({ path: fileURLToPath(new URL(`windows-${scenario}-completed.png`, output)) });
    const completed = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_downloads'));
    const blobTask = completed.find(task => task.name === 'zcMobile.apk');
    const record = path.join(process.env.APPDATA, 'dev.codex.switch.browser-downloads', 'browser-download-records', `${blobTask.id}.json`);
    const savedPath = JSON.parse(await readFile(record, 'utf8'));
    expect(await readFile(savedPath)).toEqual(Buffer.alloc(262144, 42));
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    await child.getByRole('link', { name: 'HTTP file' }).click();
    await page.getByRole('button', { name: '下载管理', exact: true }).click();
    const slow = page.getByRole('article', { name: 'sample.bin', exact: true }).last();
    await expect(slow).toContainText('已阻止不安全的下载');
    await slow.getByRole('button', { name: '保留', exact: true }).click();
    await expect(slow.getByRole('progressbar')).not.toHaveAttribute('value', '0');
    await slow.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(slow).toContainText('已暂停');
    await page.screenshot({ path: fileURLToPath(new URL(`windows-${scenario}-paused.png`, output)) });
    await slow.getByRole('button', { name: '继续下载', exact: true }).click();
    await expect(slow).toContainText('下载中');
    await page.screenshot({ path: fileURLToPath(new URL(`windows-${scenario}-progress.png`, output)) });
    await expect(slow).toContainText('已完成');
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    await child.getByRole('link', { name: 'Ordinary file' }).click();
    await page.getByRole('button', { name: '下载管理', exact: true }).click();
    await expect(page.getByRole('article', { name: 'ordinary.txt', exact: true })).toContainText('已完成');
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    await child.getByRole('button', { name: 'Blob APK' }).click();
    await page.getByRole('button', { name: '下载管理', exact: true }).click();
    const pending = page.locator('.dw-active-card').filter({ hasText: 'zcMobile.apk' });
    await expect(pending).toContainText('已阻止不安全的下载');
    await pending.getByRole('button', { name: '文件操作：zcMobile.apk' }).click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(pending).toHaveCount(0);
    const remaining = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_downloads'));
    expect(remaining.some(task => task.awaitingConfirmation)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  console.log('Native HTTP/blob downloads passed in local and remote modes.');
} finally {
  await writeFile(new URL('native.log', output), log);
  await browser?.close(); await children?.close(); native.kill();
  server.closeAllConnections(); server.close();
}
