import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const output = fileURLToPath(new URL('../../../.codex-tmp/browser-extensions-native/', import.meta.url));
const executable = process.env.BROWSER_EXTENSION_TEST_EXE;
if (!executable) throw new Error('Set BROWSER_EXTENSION_TEST_EXE to the compiled Rust lib test executable.');
await mkdir(output, { recursive: true });
const folder = output + '/unpacked';
await mkdir(folder, { recursive: true });
await writeFile(folder + '/manifest.json', JSON.stringify({
  manifest_version: 3, name: 'Remote AI extension verification', version: '1.0',
  permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'],
  content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }],
  action: { default_popup: 'popup.html', default_icon: { 20: 'icon.png' } },
}));
await copyFile(new URL('../src-tauri/resources/chrome-extension/icon.png', import.meta.url), folder + '/icon.png');
await writeFile(folder + '/content.js', `const label = document.createElement('p');
  label.id = 'extension-marker'; label.textContent = 'Extension is running';
  document.body.append(label);`);
await writeFile(folder + '/popup.html', '<!doctype html><title>Extension popup</title><p>Extension popup works</p>');
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Extension fixture</title><h1>Browser extension verification</h1>');
});
await new Promise(resolve => fixture.listen(1583, '127.0.0.1', resolve));
let child, browser, page, bridge, remote;
function launch() {
  child = spawn(executable, ['provider_browser::extensions::smoke::opens_extension_browser',
    '--ignored', '--exact', '--nocapture', '--test-threads=1'], { windowsHide: true, stdio: 'pipe' });
  child.stdout.on('data', data => process.stdout.write(data));
  child.stderr.on('data', data => process.stderr.write(data));
  return child;
}
async function connect() {
  await expect.poll(async () => {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9365'); return true; }
    catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  page = browser.contexts()[0].pages().find(page => page.url().includes('browser-extensions-harness'));
  assert.ok(page, 'native application page');
  await expect(page.getByRole('button', { name: '扩展程序', exact: true })).toBeVisible();
}
const request = input => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }), input);
const extension = command => request({ threadId: 'browser-extensions', command: { action: 'extensions', request: command } });
const nativeDrop = path => page.evaluate(async path => {
  const bounds = document.querySelector('.browser-extension-drop').getBoundingClientRect();
  await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: {
    paths: [path], position: { x: (bounds.x + bounds.width / 2) * devicePixelRatio,
      y: (bounds.y + bounds.height / 2) * devicePixelRatio },
  } });
}, path);
async function stop() {
  await browser?.close(); browser = undefined;
  if (child && child.exitCode === null) {
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await done;
  }
}
try {
  launch(); await connect();
  let list = await extension({ action: 'list' });
  assert.equal(list.supported, true);
  for (const entry of list.entries.filter(entry => entry.name === 'Remote AI extension verification')) {
    await extension({ action: 'remove', id: entry.id });
  }
  await assert.rejects(extension({ action: 'install', path: output }), /market.extensionsInvalid/);
  const chrome = await extension({ action: 'discover' });
  assert.ok(Array.isArray(chrome.candidates));
  // Exercise installation through the actual management UI.
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: '管理扩展程序', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '从 Chrome 导入', exact: true }).click();
  if (chrome.candidates.length) {
    await expect(dialog.getByText(chrome.candidates[0].name, { exact: true }).first()).toBeVisible();
    await expect.poll(() => dialog.locator('img').evaluateAll(images =>
      images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await page.screenshot({ animations: 'disabled', path: output + '/windows-chrome-extension-icons.png' });
  }
  await dialog.getByRole('button', { name: '返回扩展列表', exact: true }).click();
  await dialog.getByRole('button', { name: '浏览文件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择扩展文件或文件夹', exact: true });
  await picker.locator('.pe-address-edit').click();
  await picker.locator('.pe-address input').fill(folder);
  await picker.locator('.pe-address input').press('Enter');
  await expect(picker.getByRole('option', { name: 'manifest.json', exact: false })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: output + '/windows-local-file-browser.png' });
  await picker.getByRole('button', { name: '安装', exact: true }).click();
  await expect(dialog.getByText('Remote AI extension verification', { exact: true })).toBeVisible();
  list = await extension({ action: 'list' });
  const installed = list.entries.find(entry => entry.name === 'Remote AI extension verification');
  assert.ok(installed?.enabled);
  assert.match(installed.icon, /^data:image\/png;base64,/);
  await expect.poll(() => dialog.locator('.browser-extension-card img').last()
    .evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await extension({ action: 'pin', id: installed.id, pinned: true });
  await page.screenshot({ animations: 'disabled', path: output + '/windows-local-installed.png' });
  const exported = (await extension({ action: 'export', path: folder })).transfer;
  const chunks = [];
  for (let offset = 0; offset < exported.size; offset += 192 * 1024) {
    const chunk = (await extension({ action: 'readExport', token: exported.token, offset })).transfer;
    chunks.push(Buffer.from(chunk.data, 'base64'));
  }
  await extension({ action: 'releaseTransfer', token: exported.token });
  const archive = Buffer.concat(chunks);
  const archivePath = output + '/extension.zip';
  await writeFile(archivePath, archive);
  // Deliver the same scoped native drop event that Tauri emits for an OS file/folder drag.
  for (const path of [archivePath, folder]) {
    await nativeDrop(path);
    await expect.poll(async () => (await extension({ action: 'list' })).entries.length).toBe(2);
    const added = (await extension({ action: 'list' })).entries.find(entry => entry.id !== installed.id);
    await extension({ action: 'remove', id: added.id });
    await dialog.getByRole('button', { name: '刷新列表', exact: true }).click();
    await expect(dialog.locator('.browser-extension-cards')).toHaveAttribute('aria-busy', 'false');
  }
  // Exercise a native viewer's local export -> connected-browser upload route, even with equal host paths.
  await page.goto('http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=remote&native=1');
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: '管理扩展程序', exact: true }).click();
  await expect(dialog.locator('.browser-extension-cards')).toHaveAttribute('aria-busy', 'false');
  await nativeDrop(folder);
  await expect.poll(async () => (await extension({ action: 'list' })).entries.length).toBe(2);
  const remoteNativeAdded = (await extension({ action: 'list' })).entries.find(entry => entry.id !== installed.id);
  await extension({ action: 'remove', id: remoteNativeAdded.id });
  const opened = await request({ threadId: 'extension-verification', command: {
    action: 'open', requestId: 'extension-page', url: 'http://127.0.0.1:1583' } });
  const tabId = opened.tab.id;
  const command = command => request({ threadId: 'extension-verification', tabId, command });
  await expect.poll(async () => JSON.stringify(await command({ action: 'snapshot' })))
    .toContain('Extension is running');
  const capture = await command({ action: 'screenshot' });
  await writeFile(output + '/windows-page-extension-active.jpg', Buffer.from(capture.result.image.data, 'base64'));
  await extension({ action: 'enable', id: installed.id, enabled: false });
  await command({ action: 'reload' });
  await expect.poll(async () => JSON.stringify(await command({ action: 'snapshot' })))
    .not.toContain('Extension is running');
  await extension({ action: 'enable', id: installed.id, enabled: true });
  await command({ action: 'reload' });
  await expect.poll(async () => JSON.stringify(await command({ action: 'snapshot' })))
    .toContain('Extension is running');
  // Same real engine over a loopback transport verifies remote and Web management without mocks.
  bridge = createServer(async (incoming, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:1582');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (incoming.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      let body = ''; for await (const chunk of incoming) body += chunk;
      const input = JSON.parse(body);
      const result = incoming.url === '/browse'
        ? await page.evaluate(async input => (await window.__TAURI_INTERNALS__.invoke('codex_gui_request', {
          request: { operation: 'projectDirectories', ...input },
        })).data, input) : await request(input);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(400); response.end(String(error)); }
  });
  await new Promise(resolve => bridge.listen(1584, '127.0.0.1', resolve));
  remote = await chromium.launch(testBrowserLaunchOptions());
  for (const mode of ['remote', 'web']) {
    const viewer = await remote.newPage({ viewport: { width: 1200, height: 850 } });
    await viewer.goto('http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=' + mode + '&bridge=1');
    await viewer.getByRole('button', { name: '扩展程序', exact: true }).click();
    await expect(viewer.getByText('Remote AI extension verification', { exact: true })).toBeVisible();
    await expect.poll(() => viewer.locator('.browser-extension-row img').first()
      .evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await viewer.screenshot({ animations: 'disabled', path: output + '/windows-' + mode + '-connected-menu.png' });
    await viewer.getByRole('button', { name: '管理扩展程序', exact: true }).click();
    await viewer.getByRole('switch', { name: '停用扩展: Remote AI extension verification' }).click();
    assert.equal((await extension({ action: 'list' })).entries.find(entry => entry.id === installed.id).enabled, false);
    await viewer.getByRole('switch', { name: '启用扩展: Remote AI extension verification' }).click();
    await viewer.getByRole('button', { name: '浏览文件', exact: true }).click();
    const remotePicker = viewer.getByRole('dialog', { name: '选择扩展文件或文件夹', exact: true });
    await remotePicker.locator('.pe-address-edit').click();
    await remotePicker.locator('.pe-address input').fill(folder);
    await remotePicker.locator('.pe-address input').press('Enter');
    await expect(remotePicker.getByRole('option', { name: 'manifest.json', exact: false })).toBeVisible();
    await viewer.screenshot({ animations: 'disabled', path: output + '/windows-' + mode + '-file-browser.png' });
    await remotePicker.locator('.pe-footer button').last().click();
    await viewer.evaluate(bytes => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(bytes)], 'extension.crx'));
      document.querySelector('.browser-extension-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
    }, [...Buffer.concat([Buffer.from('Cr24\x03\0\0\0\0\0\0\0', 'binary'), archive])]);
    await expect.poll(async () => (await extension({ action: 'list' })).entries.length).toBe(2);
    await expect(viewer.getByRole('dialog').getByText('Remote AI extension verification', { exact: true })).toHaveCount(2);
    await viewer.screenshot({ animations: 'disabled', path: output + '/windows-' + mode + '-drop-installed.png' });
    const added = (await extension({ action: 'list' })).entries.find(entry => entry.id !== installed.id);
    await extension({ action: 'remove', id: added.id });
    await viewer.getByRole('button', { name: '刷新列表', exact: true }).click();
    await expect(viewer.locator('.browser-extension-cards')).toHaveAttribute('aria-busy', 'false');
    const files = await Promise.all(['manifest.json', 'icon.png', 'content.js', 'popup.html'].map(async name =>
      ({ name, bytes: [...await readFile(folder + '/' + name)] })));
    await viewer.evaluate(files => {
      let read = false;
      const children = files.map(file => ({ isFile: true, isDirectory: false, name: file.name,
        file: resolve => resolve(new File([Uint8Array.from(file.bytes)], file.name)) }));
      const entry = { isFile: false, isDirectory: true, name: 'dropped-folder', createReader: () => ({
        readEntries: resolve => { resolve(read ? [] : children); read = true; },
      }) };
      const data = new DataTransfer();
      Object.defineProperty(data, 'items', { value: [{ webkitGetAsEntry: () => entry }] });
      document.querySelector('.browser-extension-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
    }, files);
    await expect.poll(async () => (await extension({ action: 'list' })).entries.length,
      { message: 'Folder drop failed: ' + await viewer.getByRole('dialog').innerText() }).toBe(2);
    const folderAdded = (await extension({ action: 'list' })).entries.find(entry => entry.id !== installed.id);
    await extension({ action: 'remove', id: folderAdded.id });
    await viewer.close();
  }
  await remote.close(); remote = undefined;
  await command({ action: 'close' });
  await stop();
  launch(); await connect();
  const persisted = (await extension({ action: 'list' })).entries.find(entry => entry.id === installed.id);
  assert.ok(persisted?.enabled && persisted?.pinned, 'installation and pin survive a browser restart');
  await extension({ action: 'open', id: installed.id });
  let popup;
  await expect.poll(async () => {
    popup = await page.evaluate(id => window.__TAURI_INTERNALS__.invoke('extension_popup_probe', { id }), installed.id);
    return popup.text;
  }).toContain('Extension popup works');
  await writeFile(output + '/windows-extension-popup.jpg', Buffer.from(popup.image.data, 'base64'));
  // Popup creation must return while the native application is still responsive.
  assert.equal((await extension({ action: 'list' })).supported, true);
  await extension({ action: 'remove', id: installed.id });
  assert.ok(!(await extension({ action: 'list' })).entries.some(entry => entry.id === installed.id));
  await writeFile(output + '/results.json', JSON.stringify({ install: true, contentScript: true, enabled: true,
    disabled: true, remote: true, web: true, persisted: true, icons: true, popup: true, remove: true,
    chromeCandidates: chrome.candidates.length, fileBrowser: true, nativeFileAndFolderDrop: true,
    remoteArchiveAndFolderDrop: true, webArchiveAndFolderDrop: true, nativeRemoteDropTransfer: true }));
  console.log('Real WebView2 extension lifecycle and connected viewers passed');
} finally {
  await remote?.close(); await stop();
  bridge?.closeAllConnections(); bridge?.close();
  fixture.closeAllConnections(); fixture.close();
}
