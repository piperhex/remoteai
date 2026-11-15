import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const output = fileURLToPath(new URL('../../../.codex-tmp/browser-side-panel/', import.meta.url));
const executable = process.env.BROWSER_EXTENSION_TEST_EXE;
assert.ok(executable, 'Set BROWSER_EXTENSION_TEST_EXE to the Rust lib test executable.');
await mkdir(output, { recursive: true });
const folder = output + '/extension';
await mkdir(folder, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><title>Side panel verification</title>
<style>body{margin:0;padding:20px;font:14px system-ui;color:#203127;background:#f7faf8}
h1{font-size:20px}p{line-height:1.7;color:#65746b}textarea{box-sizing:border-box;width:100%;height:110px;
border:1px solid #cbd7cf;border-radius:12px;padding:12px;font:inherit}button{padding:10px 18px;
background:#437b5d;color:white;border:0;border-radius:8px;margin-top:12px}#result{padding:12px 0}</style>
<h1>Remote AI</h1><p>浏览网页，同时继续聊天。<br>侧边栏交互验证</p>
<textarea aria-label="Message" placeholder="输入消息…"></textarea><button id="send">发送</button>
<p id="result">尚未发送</p><script src="panel.js"></script>`;
const script = `document.querySelector('#send').onclick=()=>{
  document.querySelector('#result').textContent=document.querySelector('textarea').value;
};`;
await writeFile(folder + '/manifest.json', JSON.stringify({ manifest_version: 3, name: 'Side panel fixture', version: '1.0',
  permissions: ['storage'], side_panel: { default_path: 'panel.html' }, icons: { 128: 'icon.png' } }));
await writeFile(folder + '/panel.html', html); await writeFile(folder + '/panel.js', script);
await copyFile(new URL('../src-tauri/resources/chrome-extension/icon.png', import.meta.url), folder + '/icon.png');
const fixture = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/panel.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  response.end(request.url === '/panel.js' ? script : html);
});
await new Promise(resolve => fixture.listen(1583, '127.0.0.1', resolve));
let child, browser, page, viewers, bridge;
const results = [];
const request = input => page.evaluate(input => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request: input }), input);
const extension = requestValue => request({ threadId: 'browser-extensions',
  command: { action: 'extensions', request: requestValue } });
const probe = session => page.evaluate(session => window.__TAURI_INTERNALS__.invoke('extension_panel_probe', { session }), session);
const preference = () => extension({ action: 'preferences' });
async function openAssistant(viewer) {
  await viewer.locator('.browser-extensions-toolbar > button').first().click();
  await expect(viewer.getByRole('complementary', { name: '助手侧边栏' })).toBeVisible();
}
async function sessionId(viewer) {
  const surface = viewer.locator('.browser-panel-surface');
  await expect(surface).toHaveAttribute('data-session', /.+/);
  const session = await surface.getAttribute('data-session');
  await expect.poll(async () => {
    try { await probe(session); return true; } catch { return false; }
  }).toBe(true);
  return session;
}
async function verifySettings(viewer, label) {
  const session = await sessionId(viewer);
  await viewer.getByRole('button', { name: '浏览器助手设置', exact: true }).click();
  await expect(viewer.getByRole('list', { name: '浏览器使用顺序' })).toBeVisible();
  await viewer.getByRole('button', { name: '上移 AgentHub 侧边浏览器', exact: true }).click();
  await expect.poll(async () => (await preference()).preferences.order[0]).toBe('agentHub');
  await expect(viewer.getByRole('list', { name: '浏览器使用顺序' })).toHaveAttribute('aria-busy', 'false');
  await viewer.screenshot({ animations: 'disabled', path: `${output}/${label}-settings.png` });
  await viewer.getByRole('button', { name: '上移 Chrome 浏览器助手', exact: true }).click();
  await expect.poll(async () => (await preference()).preferences.order[0]).toBe('chrome');
  await viewer.getByRole('button', { name: '返回聊天', exact: true }).click();
  assert.equal(await sessionId(viewer), session, 'settings preserves the native chat document');
  assert.equal((await probe(session)).value, 'draft retained', 'settings preserves the draft');
}
async function stop() {
  await browser?.close(); browser = undefined;
  if (child?.exitCode === null) {
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done;
  }
}
try {
  child = spawn(executable, ['provider_browser::extensions::smoke::opens_extension_browser', '--ignored',
    '--exact', '--nocapture', '--test-threads=1'], { windowsHide: true, stdio: 'pipe', env: { ...process.env,
    CSW_CHROME_TEST_ROOT: output + '/preferences', CSW_BROWSER_PANEL_TEST_URL: 'http://127.0.0.1:1583/' } });
  child.stderr.on('data', data => process.stderr.write(data));
  await expect.poll(async () => {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9365'); return true; } catch { return false; }
  }, { timeout: 45000 }).toBe(true);
  page = browser.contexts()[0].pages().find(item => item.url().includes('browser-extensions-harness'));
  assert.ok(page);
  await extension({ action: 'preferences', preferences: { order: ['chrome', 'agentHub', 'standalone'] } });
  await assert.rejects(extension({ action: 'preferences', preferences: { order: ['chrome', 'chrome', 'standalone'] } }));
  for (const entry of (await extension({ action: 'list' })).entries.filter(entry => entry.name === 'Side panel fixture')) {
    await extension({ action: 'remove', id: entry.id });
  }
  const installed = (await extension({ action: 'install', path: folder })).entries.find(entry => entry.name === 'Side panel fixture');
  assert.ok(installed?.sidePanel && !installed.popup);
  // Preserve request IDs and verify default, explicit and saved destinations against the real registry.
  for (const destination of ['agentHub', 'standalone']) {
    const input = { threadId: 'side-panel-routing', command: { action: 'open', url: 'http://127.0.0.1:1583/',
      requestId: destination, destination } };
    const reply = await request(input);
    assert.equal(reply.tab.destination, destination);
    assert.equal((await request(input)).tab.id, reply.tab.id);
    await request({ threadId: 'side-panel-routing', tabId: reply.tab.id, command: { action: 'close' } });
  }
  for (const destination of ['standalone', 'agentHub']) {
    const order = ['chrome', destination, destination === 'standalone' ? 'agentHub' : 'standalone'];
    await extension({ action: 'preferences', preferences: { order } });
    const input = { threadId: 'side-panel-routing', command: { action: 'open', url: 'http://127.0.0.1:1583/',
      requestId: `saved-${destination}` } };
    const reply = await request(input);
    assert.equal(reply.tab.destination, destination);
    await extension({ action: 'preferences', preferences: { order: [...order].reverse() } });
    assert.equal((await request(input)).tab.id, reply.tab.id, 'retries preserve the existing destination');
    await request({ threadId: 'side-panel-routing', tabId: reply.tab.id, command: { action: 'close' } });
  }
  await extension({ action: 'preferences', preferences: { order: ['chrome', 'agentHub', 'standalone'] } });
  // Use a loopback client to the same real engine for connected desktop and Web rendering.
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
  viewers = await chromium.launch(testBrowserLaunchOptions());
  for (const mode of ['local', 'remote', 'web']) for (const entry of ['standalone', 'agentHub']) {
    const viewer = mode === 'local' ? page : await viewers.newPage({ viewport: { width: 1200, height: 850 } });
    for (const enlarged of [false, true]) {
      const label = `${mode}-${entry}-${enlarged ? 'dark-font20-narrow' : 'light-font14-wide'}`;
      if (mode === 'local') await page.evaluate(size => window.__TAURI_INTERNALS__.invoke('extension_test_resize', size),
        { width: enlarged ? 960 : 1440, height: 900 });
      else await viewer.setViewportSize({ width: enlarged ? 960 : 1440, height: 900 });
      await viewer.goto(`http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=${mode}&entry=${entry}`
        + (mode === 'local' ? '&native=1' : '&bridge=1') + (enlarged ? '&dark=1&font=20' : ''));
      await openAssistant(viewer);
      const session = await sessionId(viewer);
      await expect.poll(async () => (await probe(session)).text).toContain('侧边栏交互验证');
      if (mode === 'local') {
        await extension({ action: 'panel', session, command: { action: 'click', x: 60, y: 180 } });
        await extension({ action: 'panel', session, command: { action: 'text', text: 'draft retained' } });
      } else {
        await viewer.locator('.browser-panel-surface img').click({ position: { x: 60, y: 180 } });
        await viewer.keyboard.type('draft retained');
      }
      await expect.poll(async () => (await probe(session)).value).toBe('draft retained');
      await expect.poll(async () => (await probe(session)).ipc,
        { message: 'unprivileged panel cannot invoke application IPC' }).toBe(false);
      if (mode !== 'local') await expect(viewer.locator('.browser-panel-surface img')).toBeVisible();
      const fontSize = await viewer.locator('.browser-side-panel').evaluate(element => getComputedStyle(element).fontSize);
      assert.equal(fontSize, `${mode === 'web' ? (enlarged ? 20 : 14) : (enlarged ? 16 : 12)}px`);
      // Remote capture is intentionally single-flight; wait for the next frame before recording evidence.
      if (mode !== 'local') await viewer.waitForTimeout(800);
      await viewer.screenshot({ animations: 'disabled', path: `${output}/${label}-chat.png` });
      const image = (await extension({ action: 'panel', session, command: { action: 'capture' } })).result.image;
      await writeFile(`${output}/${label}-native-page.jpg`, Buffer.from(image.data, 'base64'));
      await verifySettings(viewer, label);
      expect(await viewer.locator('.browser-side-panel').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await viewer.getByRole('button', { name: '关闭侧边栏', exact: true }).click();
      await expect.poll(async () => { try { await probe(session); return false; } catch { return true; } }).toBe(true);
      results.push({ mode, entry, enlarged, chat: true, settings: true, cleanup: true });
    }
    if (mode !== 'local') await viewer.close();
  }
  // Opening an installed extension docks its actual extension-origin document, with extension APIs.
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: 'Side panel fixture 已启用', exact: false }).click();
  const extensionSession = await sessionId(page);
  await expect.poll(async () => (await probe(extensionSession)).extension).toBe(installed.id);
  await extension({ action: 'enable', id: installed.id, enabled: false });
  await assert.rejects(probe(extensionSession), /panel missing/);
  await assert.rejects(extension({ action: 'panel', session: crypto.randomUUID(), command: { action: 'open', extension: installed.id } }));
  await extension({ action: 'remove', id: installed.id });
  const packaged = (await extension({ action: 'install', path: fileURLToPath(
    new URL('../src-tauri/resources/chrome-extension/', import.meta.url)) })).entries.find(entry => /Remote AI/.test(entry.name));
  assert.ok(packaged?.sidePanel);
  await page.getByRole('button', { name: '扩展程序', exact: true }).click();
  await page.getByRole('button', { name: `${packaged.name} 已启用`, exact: false }).click();
  const packagedSession = await sessionId(page);
  await expect.poll(async () => (await probe(packagedSession)).extension).toBe(packaged.id);
  await expect.poll(async () => (await probe(packagedSession)).text).toContain('Remote AI');
  await extension({ action: 'remove', id: packaged.id });
  await writeFile(output + '/results.json', JSON.stringify({ results, destinationRouting: true,
    extensionOrigin: true, packagedAssistant: true, disabledClosesPanel: true, defaultOrderPreserved: true }, null, 2));
  console.log('Real browser side panels, settings and destination routing passed');
} finally {
  await viewers?.close(); await stop();
  bridge?.closeAllConnections(); bridge?.close(); fixture.closeAllConnections(); fixture.close();
}
