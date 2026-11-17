import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';
import { probe, verifyContextMenus } from './browser-context-menu-checks.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass a copied native test executable; start desktop Vite on 1552.');
const output = new URL('../../../.codex-tmp/browser-context-menu/', import.meta.url);
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:18326';
const expect = baseExpect.configure({ timeout: 20_000 });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body style="margin:0;background:#e6f4ff;font:18px system-ui;user-select:none">
    <header style="padding:20px;background:#15395b;color:white">Context menu position verification</header>
    <main style="padding:24px"><h2>Windows WebView2</h2><p>Right-click / touch and hold</p>
    <div id="target" style="position:absolute;left:260px;top:180px;width:24px;height:24px;
      border:2px solid #e34d59;border-radius:50%;pointer-events:none"></div></main>
    <script>window.lastContextMenu=null;addEventListener('contextmenu',e=>{
      window.lastContextMenu={x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY};
      Object.assign(document.querySelector('#target').style,{left:e.clientX-12+'px',top:e.clientY-12+'px'});
    });</script></body></html>`);
});
await new Promise(resolve => server.listen(18326, '127.0.0.1', resolve));
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
  BROWSER_TEST_IDENTIFIER: 'dev.codex.switch.context-menu-position',
  BROWSER_TEST_DEBUG_PORT: '9363', BROWSER_TEST_CHILD_DEBUG_PORT: '9364',
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let nativeLog = '';
native.stdout.on('data', chunk => { nativeLog += chunk; });
native.stderr.on('data', chunk => { nativeLog += chunk; });
let browser, childBrowser;
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9363/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9363');
  await expect.poll(() => browser.contexts()[0].pages()
    .some(item => item.url().includes('website-tabs-harness'))).toBe(true);
  const page = browser.contexts()[0].pages().find(item => item.url().includes('website-tabs-harness'));
  await page.goto('http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=local');
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('fixture_size', {width:1000,height:700}));
  await page.getByLabel('页面地址', { exact: true }).fill(origin);
  await page.getByLabel('页面地址', { exact: true }).press('Enter');
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9364/json/version')).ok; } catch { return false; }
  }).toBe(true);
  childBrowser = await chromium.connectOverCDP('http://127.0.0.1:9364');
  await expect.poll(() => childBrowser.contexts().flatMap(context => context.pages())
    .some(item => item.url().startsWith(origin))).toBe(true);
  const findChild = async () => {
    await expect.poll(() => childBrowser.contexts().flatMap(context => context.pages())
      .some(item => item.url().startsWith(origin))).toBe(true);
    return childBrowser.contexts().flatMap(context => context.pages()).find(item => item.url().startsWith(origin));
  };
  const child = await findChild();
  probe(native.pid, 'prepare');
  console.log(JSON.stringify({pid:native.pid, main:await page.evaluate(() => ({
    dpr:devicePixelRatio,width:innerWidth,height:innerHeight})), child:await child.evaluate(() => ({
    dpr:devicePixelRatio,width:innerWidth,height:innerHeight}))}));
  if (process.argv.includes('--before')) {
    await child.mouse.click(280, 200, { button:'right' });
    console.log('READY', JSON.stringify(await child.evaluate(() => window.lastContextMenu)));
    console.log(probe(native.pid, 'read', fileURLToPath(new URL('before-local-dpi125-composed.png', output))));
  } else {
    await verifyContextMenus({ main:page, child, pid:native.pid, output, findChild });
  }
  await writeFile(new URL('native.log', output), nativeLog);
  if (process.argv.includes('--keep-open')) await new Promise(resolve => native.once('exit', resolve));
} finally {
  await writeFile(new URL('native.log', output), nativeLog);
  await browser?.close();
  await childBrowser?.close();
  native.kill();
  server.closeAllConnections();
  server.close();
}
