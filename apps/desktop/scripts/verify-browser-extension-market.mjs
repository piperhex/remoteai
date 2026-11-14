// Run with the isolated Go marketplace fixture (1592), admin UI (1593) and browser harness (1582).
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const output = fileURLToPath(new URL('../../../.codex-tmp/browser-extension-market-evidence/', import.meta.url));
const executable = process.env.BROWSER_EXTENSION_TEST_EXE;
if (!executable) throw new Error('Set BROWSER_EXTENSION_TEST_EXE to the compiled Rust lib test executable.');
const base = 'http://127.0.0.1:1592', adminBase = '/admin/api/browser-extensions';
await mkdir(output + '/package', { recursive: true });
const folder = output + '/package', title = 'Remote AI market verification';
await copyFile(new URL('../src-tauri/resources/chrome-extension/icon.png', import.meta.url), folder + '/icon.png');
await writeFile(folder + '/content.js', `const marker = document.createElement('p');
  marker.textContent = 'Market extension installed'; document.body.append(marker);`);
const fixture = createServer((_request, response) => response.end('<!doctype html><title>Market test</title><p>Test page</p>'));
await new Promise(resolve => fixture.listen(1583, '127.0.0.1', resolve));
let child, nativeBrowser, native, viewerBrowser, bridge;
async function api(path = '', options = {}) {
  const response = await fetch(base + adminBase + path, { ...options,
    headers: { Authorization: 'Bearer extension-fixture', 'Content-Type': 'application/json', ...options.headers } });
  assert.ok(response.ok, `fixture API ${path}: ${response.status}`);
  return response.json();
}
async function launch() {
  child = spawn(executable, ['provider_browser::extensions::smoke::opens_extension_browser',
    '--ignored', '--exact', '--nocapture', '--test-threads=1'], { windowsHide: true, stdio: 'pipe' });
  child.stderr.on('data', data => process.stderr.write(data));
  await expect.poll(async () => {
    try { nativeBrowser = await chromium.connectOverCDP('http://127.0.0.1:9365'); return true; }
    catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => {
    native = nativeBrowser.contexts()[0].pages().find(page => page.url().includes('browser-extensions-harness'));
    return !!native;
  }, { timeout: 30_000 }).toBe(true);
  await expect(native.getByRole('button', { name: '扩展程序', exact: true })).toBeVisible();
}
async function stop() {
  await nativeBrowser?.close(); nativeBrowser = undefined;
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped;
  }
}
const request = input => native.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }), input);
const extension = command => request({ threadId: 'browser-extensions', command: { action: 'extensions', request: command } });
async function archive(version) {
  await writeFile(folder + '/manifest.json', JSON.stringify({ manifest_version: 3, name: title, version,
    description: '在页面上添加阅读标记，方便继续浏览。', icons: { 48: 'icon.png' }, permissions: ['storage'],
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }));
  const transfer = (await extension({ action: 'export', path: folder })).transfer;
  const chunks = [];
  try {
    for (let offset = 0; offset < transfer.size; offset += 192 * 1024) {
      const result = await extension({ action: 'readExport', token: transfer.token, offset });
      chunks.push(Buffer.from(result.transfer.data, 'base64'));
    }
  } finally { await extension({ action: 'releaseTransfer', token: transfer.token }); }
  return Buffer.concat(chunks);
}
async function market(page) {
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: '管理扩展程序', exact: true }).click();
  await page.getByText('插件市场', { exact: true }).click();
  await expect(page.locator('.browser-extension-market').getByText(title, { exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.browser-extension-market img').first().evaluate(image => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.waitForTimeout(350);
}
async function install(page, label) {
  await page.getByRole('button', { name: /^安\s*装$/ }).click();
  const review = page.getByRole('dialog', { name: '确认所需权限' });
  await expect(review.getByText('storage', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: `${output}/${label}-permissions.png` });
  await review.getByRole('button', { name: /^安\s*装$/ }).click();
  await expect(page.getByRole('button', { name: '已安装', exact: true })).toBeDisabled({ timeout: 30_000 });
  await page.screenshot({ animations: 'disabled', path: `${output}/${label}-installed.png` });
}
async function verifyContent() {
  const opened = await request({ threadId: 'market-test', command: {
    action: 'open', requestId: 'market-test-page', url: 'http://127.0.0.1:1583' } });
  const tabId = opened.tab.id;
  await expect.poll(async () => JSON.stringify(await request({ threadId: 'market-test', tabId,
    command: { action: 'snapshot' } }))).toContain('Market extension installed');
  await request({ threadId: 'market-test', tabId, command: { action: 'close' } });
}
try {
  await launch();
  for (const item of (await api()).items) await api('/' + item.id, { method: 'DELETE' });
  for (const item of (await extension({ action: 'list' })).entries.filter(item => item.name === title)) {
    await extension({ action: 'remove', id: item.id });
  }
  const first = await archive('1.0');
  viewerBrowser = await chromium.launch(testBrowserLaunchOptions());
  const admin = await viewerBrowser.newPage({ viewport: { width: 1380, height: 900 } });
  await admin.goto('http://127.0.0.1:1593/scripts/browser-extension-market.html');
  await admin.locator('.ant-upload input').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await expect(admin.getByText('无法使用此插件包。', { exact: false })).toBeVisible();
  await admin.locator('.ant-upload input').setInputFiles({ name: 'marker.zip', mimeType: 'application/zip', buffer: first });
  await expect(admin.getByText(title, { exact: true })).toBeVisible();
  await expect(admin.getByText('未上架', { exact: true })).toBeVisible();
  await expect.poll(() => admin.locator('.admin-extension-avatar img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect(admin.locator('.ant-message-notice')).toHaveCount(0, { timeout: 6000 });
  await admin.screenshot({ animations: 'disabled', path: output + '/admin-light-uploaded-draft.png' });
  const item = (await api()).items[0];
  const packageURL = `${base}/browser-extensions/${item.id}/archive?sha256=${item.sha256}`;
  assert.equal((await fetch(packageURL)).status, 404);
  await admin.getByRole('button', { name: /^上\s*架$/ }).click();
  await expect(admin.getByText('已上架', { exact: true })).toBeVisible();
  await admin.screenshot({ animations: 'disabled', path: output + '/admin-light-published.png' });
  await market(native); await install(native, 'windows-local-light');
  await verifyContent();
  await native.goto('http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=local&native=1&dark=1&font=20');
  await native.setViewportSize({ width: 960, height: 900 });
  await market(native);
  await native.screenshot({ animations: 'disabled', path: output + '/windows-local-dark-enlarged.png' });
  bridge = createServer(async (incoming, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:1582');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (incoming.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      let body = ''; for await (const chunk of incoming) body += chunk;
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await request(JSON.parse(body))));
    } catch (error) { response.writeHead(400); response.end(String(error)); }
  });
  await new Promise(resolve => bridge.listen(1584, '127.0.0.1', resolve));
  for (const mode of ['remote', 'web']) {
    for (const entry of (await extension({ action: 'list' })).entries.filter(entry => entry.market?.id === item.id)) {
      await extension({ action: 'remove', id: entry.id });
    }
    const page = await viewerBrowser.newPage({ viewport: { width: 1380, height: 900 } });
    const url = `http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=${mode}&bridge=1&market=${base}`;
    await page.goto(url); await market(page); await install(page, `windows-${mode}-light`);
    await page.setViewportSize({ width: 960, height: 900 }); await page.goto(url + '&dark=1&font=20');
    await market(page); await page.screenshot({ animations: 'disabled', path: `${output}/windows-${mode}-dark-enlarged.png` });
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    if (mode === 'web') {
      await page.route(base + '/browser-extensions', route => route.abort());
      await page.locator('.browser-extension-market').getByRole('button', { name: '刷新列表' }).click();
      await expect(page.getByText('插件市场加载失败，请重试。')).toBeVisible();
      await page.screenshot({ animations: 'disabled', path: output + '/windows-web-offline.png' });
    }
    await page.close();
  }
  await admin.setViewportSize({ width: 850, height: 1000 });
  await admin.goto('http://127.0.0.1:1593/scripts/browser-extension-market.html?dark=1&large=1');
  await expect(admin.getByText(title, { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: '所需权限', exact: true }).click();
  await expect(admin.locator('.ant-popover').getByText('storage', { exact: true })).toBeVisible();
  await admin.waitForTimeout(350);
  await admin.screenshot({ animations: 'disabled', path: output + '/admin-dark-narrow-permissions.png' });
  await admin.keyboard.press('Escape');
  const next = await archive('2.0');
  await admin.getByRole('button', { name: '替换安装包: ' + title }).click();
  await admin.locator('input[hidden]').setInputFiles({ name: 'marker-v2.zip', mimeType: 'application/zip', buffer: next });
  await expect(admin.getByText('未上架', { exact: true })).toBeVisible();
  assert.equal((await fetch(packageURL)).status, 404);
  await admin.getByRole('button', { name: /^上\s*架$/ }).click();
  await expect(admin.getByText('已上架', { exact: true })).toBeVisible();
  await native.reload(); await market(native); await install(native, 'windows-local-updated');
  const installed = (await extension({ action: 'list' })).entries.filter(entry => entry.market?.id === item.id);
  assert.equal(installed.length, 1); assert.equal(installed[0].version, '2.0');
  await stop(); await launch();
  assert.equal((await extension({ action: 'list' })).entries.find(entry => entry.market?.id === item.id).version, '2.0');
  await admin.getByRole('button', { name: /^下\s*架$/ }).click();
  await expect(admin.getByText('未上架', { exact: true })).toBeVisible();
  assert.equal((await (await fetch(base + '/browser-extensions')).json()).items.length, 0);
  await admin.getByRole('button', { name: '删除: ' + title }).click();
  await admin.getByRole('button', { name: /^确\s*定$/ }).click();
  await expect(admin.getByText('尚未上传插件')).toBeVisible();
  await admin.goto('http://127.0.0.1:1593/scripts/browser-extension-market.html?en=1&readonly=1');
  await expect(admin.getByText('No extensions uploaded')).toBeVisible();
  await expect(admin.locator('.ant-upload')).toHaveCount(0);
  await admin.screenshot({ animations: 'disabled', path: output + '/admin-readonly-english-empty.png' });
  assert.ok((await extension({ action: 'list' })).entries.some(entry => entry.market?.id === item.id));
  await extension({ action: 'remove', id: installed[0].id });
  await writeFile(output + '/results.json', JSON.stringify({ adminUpload: true, invalidArchive: true, draft: true,
    publish: true, icons: true, local: true, remoteLoopback: true, webLoopback: true, permissions: true,
    contentScript: true, replacement: true, persistence: true, unpublish: true, delete: true }, null, 2));
  console.log('Admin -> marketplace -> real WebView2 install, update and persistence passed');
} catch (error) {
  await native?.screenshot({ path: output + '/failure-native.png' }).catch(() => {});
  throw error;
} finally {
  await viewerBrowser?.close(); await stop(); bridge?.closeAllConnections(); bridge?.close();
  fixture.closeAllConnections(); fixture.close();
}
