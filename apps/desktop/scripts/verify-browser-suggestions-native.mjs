import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the native test executable; start Vite on port 1552 first.');
const expect = baseExpect.configure({ timeout: 15000 });
const origin = 'http://127.0.0.1:18318', debugPort = 9346, childDebugPort = 9347;
const output = new URL('../../../.codex-tmp/browser-suggestions-native/', import.meta.url);
await mkdir(output, { recursive: true });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<title>History destination</title><body style="margin:0;font:18px system-ui;background:#e6f4ff">'
    + '<header style="padding:28px;background:#15395b;color:white">Remote AI 浏览器</header>'
    + '<main style="padding:32px;height:1800px"><h1>历史地址候选</h1>'
    + '<p>选择候选后打开对应页面，收起列表后继续浏览。</p><input aria-label="Page draft" value="original">'
    + '<div style="margin-top:36px;height:280px;background:linear-gradient(120deg,#82c9ee,#c6f2d7)"></div></main>'
    + '<script>window.pageIdentity=crypto.randomUUID()</script></body>');
});
await new Promise(resolve => server.listen(18318, '127.0.0.1', resolve));
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  BROWSER_TEST_IDENTIFIER: 'dev.codex.switch.address-suggestions-smoke',
  BROWSER_TEST_DEBUG_PORT: String(debugPort), BROWSER_TEST_CHILD_DEBUG_PORT: String(childDebugPort),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
let childBrowser;
let page;
const shot = label => page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), animations: 'disabled' });

async function childPage(path) {
  if (!childBrowser) {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${childDebugPort}/json/version`)).ok; } catch { return false; }
    }).toBe(true);
    childBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${childDebugPort}`);
  }
  const context = childBrowser.contexts()[0];
  await expect.poll(() => context.pages().some(page => page.url() === `${origin}/${path}`)).toBe(true);
  return context.pages().find(page => page.url() === `${origin}/${path}`);
}

async function verifyNative(label) {
  const address = page.getByRole('combobox', { name: '页面地址', exact: true });
  await address.fill(`${origin}/current`); await address.press('Enter');
  const child = await childPage('current');
  await child.getByRole('textbox', { name: 'Page draft' }).fill('保留输入内容');
  await child.evaluate(() => scrollTo(0, 120));
  const identity = await child.evaluate(() => window.pageIdentity);
  await address.fill('127.0.0.1');
  const list = page.getByRole('listbox', { name: '历史记录', exact: true });
  await expect(list.getByRole('option')).toHaveCount(4);
  const preview = page.locator('.native-browser-overlay-preview');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await address.press('ArrowDown'); await address.press('ArrowDown');
  await shot(`${label}-keyboard-over-page`);
  await address.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(child.getByRole('textbox', { name: 'Page draft' })).toHaveValue('保留输入内容');
  expect(await child.evaluate(() => window.pageIdentity)).toBe(identity);
  expect(await child.evaluate(() => scrollY)).toBe(120);
  await address.fill('账户');
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option').click();
  await expect(address).toHaveValue(`${origin}/admin`);
  await expect((await childPage('admin')).getByRole('heading', { name: '历史地址候选' })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await shot(`${label}-selected`);
  console.log(`PASS ${label}: native overlay, keyboard, click, preserved input and scroll`);
}

try {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 60000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().some(page => page.url().includes('website-tabs-harness'))).toBe(true);
  page = context.pages().find(page => page.url().includes('website-tabs-harness'));
  await page.addInitScript(origin => {
    for (const scope of ['bookmarks-local', 'bookmarks-remote']) {
      const entries = [['workspace', 'Remote AI 工作台'], ['admin', '账户中心'], ['docs', '开发文档与使用指南']]
        .map(([path, title], index) => ({ id: `suggestion-${index}`, kind: 'visit',
          url: `${origin}/${path}`, title, at: 100 - index }));
      localStorage.setItem(`remoteai:browser-data:${scope}`, JSON.stringify({ document: { revision: 0, entries } }));
    }
  }, origin);
  for (const mode of ['local', 'remote']) for (const sidebar of [false, true]) for (const enlarged of [false, true]) {
    await page.setViewportSize({ width: enlarged ? 900 : 1440, height: 900 });
    await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}`
      + (sidebar ? '&sidebar=1' : '') + (enlarged ? '&dark=1&font=20' : ''), { waitUntil: 'domcontentloaded' });
    await verifyNative(
      `windows-${mode}-${sidebar ? 'sidebar' : 'main'}-${enlarged ? 'dark-20px-narrow' : 'light-14px'}`);
  }
} catch (error) {
  if (page) await shot('failure');
  throw error;
} finally {
  await childBrowser?.close(); await browser?.close();
  native.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
