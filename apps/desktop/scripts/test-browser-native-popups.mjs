import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';
import { verifyAddress, verifyBookmarks, verifyPasswords, verifySettings } from './browser-native-popup-checks.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the codex_switch_lib_tests executable; start Vite on port 1552.');
const keepOpen = process.argv.includes('--keep-open');
const expect = baseExpect.configure({ timeout: 15_000 });
const origin = 'http://127.0.0.1:18316';
const debugPort = 9343;
const output = new URL('../../../.codex-tmp/browser-native-popups/', import.meta.url);
await mkdir(output, { recursive: true });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body style="margin:0;background:#e6f4ff;color:#15395b;font:18px system-ui">
    <header style="padding:28px;background:#15395b;color:white">Remote AI · 实时网页验证</header>
    <main style="padding:32px"><h1>菜单打开时网页继续工作</h1><p>动画帧：<b id="frames">0</b></p>
    <label>页面输入 <input aria-label="page-draft" value="original"></label>
    <form><input aria-label="username" autocomplete="username"><input aria-label="password" type="password"
    autocomplete="current-password"><button>登录</button></form>
    <div id="animation" style="margin-top:30px;width:120px;height:120px;background:#5bad86;border-radius:20px"></div>
    <div style="height:1200px"></div></main><script>
    window.pageIdentity=crypto.randomUUID();window.frameCount=0;
    function tick(){document.querySelector('#frames').textContent=++window.frameCount;
      document.querySelector('#animation').style.transform='translateX('+(window.frameCount%180)+'px)';
      requestAnimationFrame(tick)}tick();</script></body></html>`);
});
await new Promise(resolve => server.listen(18316, '127.0.0.1', resolve));
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
  BROWSER_TEST_DEBUG_PORT: String(debugPort), BROWSER_TEST_CHILD_DEBUG_PORT: String(debugPort + 1),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let nativeLog = '';
native.stdout.on('data', chunk => { nativeLog += chunk; });
native.stderr.on('data', chunk => { nativeLog += chunk; });
let browser, childBrowser, page;
try {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().some(item => item.url().includes('website-tabs-harness'))).toBe(true);
  page = context.pages().find(item => item.url().includes('website-tabs-harness'));
  page.on('console', message => { if (message.type() === 'error') console.log('UI', message.text()); });
  page.on('pageerror', error => console.log('PAGE', error.message));
  await context.addInitScript(origin => {
    for (const scope of ['native-popups-local', 'native-popups-remote', 'guest']) {
      localStorage.setItem(`remoteai:browser-bookmarks:${scope}`, JSON.stringify({ document: { revision: 0, entries: [
        { id: 'popup-test', kind: 'link', title: '实时测试页面', url: `${origin}/`, parentId: '', position: 0 },
      ] } }));
    }
  }, origin);
  for (const mode of ['local', 'remote']) for (const narrow of [false, true]) {
  const label = `windows-${mode}-${narrow ? 'dark-narrow-font20' : 'light-wide-font14'}`;
  await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}&nativePopups=1`
    + (narrow ? '&dark=1&font=20' : ''));
  await page.evaluate(({ width, height }) => window.__TAURI_INTERNALS__.invoke('fixture_size', { width, height }),
    { width: narrow ? 1000 : 1440, height: 900 });
  await expect(page.locator('body')).toHaveAttribute('data-popup-fixture', 'ready');
  await page.getByLabel('页面地址', { exact: true }).fill(origin);
  await page.getByLabel('页面地址', { exact: true }).press('Enter');
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort + 1}/json/version`)).ok; } catch { return false; }
  }).toBe(true);
  childBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort + 1}`);
  await expect.poll(() => childBrowser.contexts().flatMap(item => item.pages()).some(item => item.url().startsWith(origin)))
    .toBe(true);
  const child = childBrowser.contexts().flatMap(item => item.pages()).find(item => item.url().startsWith(origin));
  await expect.poll(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json()))
    .some(item => item.url.startsWith('about:blank#remoteai-browser-overlay'))).toBe(true);
  await browser.close();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  page = browser.contexts().flatMap(item => item.pages()).find(item => item.url().includes('browser-bookmarks-harness'));
  const popup = browser.contexts().flatMap(item => item.pages())
    .find(item => item.url().startsWith('about:blank#remoteai-browser-overlay'));
  console.log('Popup attached', popup.url());
  const draft = child.getByLabel('page-draft');
  await draft.fill('实时输入保留');
  const identity = await child.evaluate(() => window.pageIdentity);
  const capture = async state => {
    await popup.screenshot({ path: fileURLToPath(new URL(`${label}-${state}-popup.png`, output)) });
    await child.screenshot({ path: fileURLToPath(new URL(`${label}-${state}-page.png`, output)) });
  };
  const fixture = { main: page, popup, child, capture };
  await verifySettings(fixture);
  await verifyBookmarks(fixture);
  await verifyAddress(fixture);
  await verifyPasswords(fixture);
  expect(await child.evaluate(() => window.pageIdentity)).toBe(identity);
  await expect(draft).toHaveValue('实时输入保留');
  console.log(`PASS ${label}: settings, nested menus, history, bookmarks, touch, password typing/fill/keyboard; live page`);
  await childBrowser.close(); childBrowser = undefined;
  }
  await page.evaluate(() => localStorage.setItem('codex-switch:global-font-size', '14'));
  await page.goto('http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=local&native=1');
  await page.evaluate(async origin => {
    await window.__TAURI_INTERNALS__.invoke('fixture_size', { width: 1440, height: 900 });
    await window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request: { threadId: 'preview-thread',
      command: { action: 'open', url: `${origin}/managed`, requestId: crypto.randomUUID() } } });
  }, origin);
  childBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort + 1}`);
  await expect.poll(() => childBrowser.contexts().flatMap(item => item.pages())
    .some(item => item.url().endsWith('/managed'))).toBe(true);
  const child = childBrowser.contexts().flatMap(item => item.pages()).find(item => item.url().endsWith('/managed'));
  await expect.poll(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json()))
    .some(item => item.url.startsWith('about:blank#remoteai-browser-overlay'))).toBe(true);
  await browser.close();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  page = browser.contexts().flatMap(item => item.pages()).find(item => item.url().includes('website-tabs-harness'));
  const popup = browser.contexts().flatMap(item => item.pages()).find(item => item.url().startsWith('about:blank#'));
  const capture = state => popup.screenshot({ path: fileURLToPath(new URL(`windows-managed-${state}.png`, output)) });
  await verifySettings({ main: page, popup, child, capture });
  await verifyBookmarks({ main: page, popup, child, capture });
  console.log('PASS windows-managed: live conversation browser, settings, bookmarks, right-click and touch');
} catch (error) {
  console.error(error);
  if (browser) console.log('Pages:', browser.contexts()[0].pages().map(item => item.url()));
  if (page) {
    console.log('UI:', (await page.locator('body').innerText()).slice(-1800));
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) });
  }
  if (!keepOpen) throw error;
} finally {
  await writeFile(new URL('native.log', output), nativeLog);
  if (!keepOpen) { await browser?.close(); await childBrowser?.close(); native.kill(); server.closeAllConnections(); server.close(); }
  else console.log('Harness retained for native screenshots; PID', native.pid);
}
