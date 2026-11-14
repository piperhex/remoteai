import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the current Rust test executable; run Vite on port 1552 first.');
const expect = baseExpect.configure({ timeout: 30_000 });
const output = new URL('../../../.codex-tmp/website-icons-native/', import.meta.url);
await mkdir(output, { recursive: true });
const icon = await readFile(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const origin = 'http://127.0.0.1:18316';
const source = `${origin}/assets/declared.png`;
const site = `${origin}/page`;
const server = createServer((request, response) => {
  if (request.url === '/assets/declared.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(icon); return;
  }
  if (request.url !== '/page') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><head><link rel="icon" href="/assets/declared.png"><title>Declared icon</title></head>'
    + '<body><h1>Declared website icon</h1></body>');
});
await new Promise(resolve => server.listen(18316, '127.0.0.1', resolve));
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit', env: { ...process.env,
  BROWSER_TEST_DEBUG_PORT: '9337', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9337/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  const context = browser.contexts()[0];
  let page;
  await expect.poll(() => {
    page = context.pages().find(entry => entry.url().includes('website-tabs-harness')); return !!page;
  }).toBe(true);
  for (const mode of ['local', 'remote']) {
    await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}`);
    await page.evaluate(({ site, mode }) => {
      localStorage.removeItem('remoteai:website-icons:v1');
      localStorage.setItem(`remoteai:browser-bookmarks:bookmarks-${mode}`, JSON.stringify({ document: {
        revision: 0, entries: [
          { id: 'chatgpt', kind: 'link', title: 'ChatGPT', url: 'https://chatgpt.com/', parentId: '', position: 0 },
          { id: 'declared', kind: 'link', title: 'Declared icon', url: site, parentId: '', position: 1 },
        ],
      } }));
    }, { site, mode });
    await page.reload();
    const chrome = page.locator('.browser-main-page');
    const bounds = await chrome.boundingBox();
    if (!bounds) throw new Error('Browser chrome is missing');
    const clip = { ...bounds, height: 150 };
    const declared = chrome.locator('[data-bookmark-id="declared"]');
    await declared.click();
    for (const image of [declared.locator('img'), chrome.getByRole('tab').locator('img'),
      chrome.locator('.pm-browser-toolbar img')]) {
      await expect(image).toHaveAttribute('src', source);
      await expect(image).toHaveAttribute('data-loaded', 'true');
    }
    await page.screenshot({ clip, path: fileURLToPath(new URL(`windows-${mode}-declared.png`, output)) });
    await chrome.locator('[data-bookmark-id="chatgpt"]').click();
    await expect(chrome.locator('[data-bookmark-id="chatgpt"] img')).toHaveAttribute('data-loaded', 'true');
    await expect(chrome.getByRole('tab').locator('img')).toHaveAttribute('data-loaded', 'true');
    await expect(chrome.locator('.pm-browser-toolbar img')).toHaveAttribute('data-loaded', 'true');
    await page.screenshot({ clip, path: fileURLToPath(new URL(`windows-${mode}-chatgpt.png`, output)) });
  }
  const request = async (command, tabId) => page.evaluate(({ command, tabId }) =>
    window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request: { threadId: 'icon-verification', tabId, command } }),
  { command, tabId });
  const opened = await request({ action: 'open', url: site, requestId: 'icon-verification' });
  try {
    await expect.poll(async () => (await request({ action: 'list' })).tabs[0]?.icons).toEqual([source]);
    const capture = await request({ action: 'screenshot' }, opened.tab.id);
    assert.deepEqual(capture.result.icons, [source]);
  } finally { await request({ action: 'close' }, opened.tab.id); }
  console.log('Windows local/remote declared icons, live ChatGPT icons and remote screenshot metadata passed.');
} finally {
  await browser?.close(); native.kill(); server.closeAllConnections(); server.close();
}
