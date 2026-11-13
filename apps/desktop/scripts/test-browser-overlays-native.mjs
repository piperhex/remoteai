import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the codex_switch_lib_tests executable; start Vite on port 1552 first.');
const expect = baseExpect.configure({ timeout: 15_000 });
const debugPort = 9343;
const origin = 'http://127.0.0.1:18316';
const output = new URL('../../../.codex-tmp/browser-overlay-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<body style="margin:0;font:18px system-ui;background:#e6f4ff;color:#15395b">'
    + '<header style="padding:28px;background:#15395b;color:white">Remote AI · 浏览器页面</header>'
    + '<main style="padding:32px;height:1800px"><h1>打开菜单时保留网页画面</h1>'
    + '<p>关闭菜单后，页面位置和输入内容保持不变。</p><input aria-label="page-draft" value="original">'
    + '<div style="margin-top:36px;height:280px;background:linear-gradient(120deg,#82c9ee,#c6f2d7)"></div></main>'
    + '<script>window.pageIdentity=crypto.randomUUID()</script></body>');
});
await new Promise(resolve => server.listen(18316, '127.0.0.1', resolve));
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  BROWSER_TEST_DEBUG_PORT: String(debugPort), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
let page;
const shot = label => page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), animations: 'disabled' });

async function childPage(context) {
  await expect.poll(() => context.pages().some(p => p.url().startsWith(origin))).toBe(true);
  const child = context.pages().find(p => p.url().startsWith(origin));
  await expect(child.getByRole('textbox', { name: 'page-draft' })).toBeVisible();
  return child;
}

async function verifyMenus(root, child, label) {
  const draft = child.getByRole('textbox', { name: 'page-draft' });
  await draft.fill('已输入，菜单关闭后保留');
  await child.evaluate(() => scrollTo(0, 120));
  const identity = await child.evaluate(() => window.pageIdentity);
  const image = root.locator('.native-browser-overlay-preview');
  const settings = root.getByRole('button', { name: '浏览器设置', exact: true });
  const address = root.getByRole('textbox', { name: '页面地址', exact: true });
  const preserved = async state => {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await shot(`${label}-${state}`);
  };
  const restored = async () => {
    await expect(image).toHaveCount(0);
    await expect(draft).toHaveValue('已输入，菜单关闭后保留');
    expect(await child.evaluate(() => window.pageIdentity)).toBe(identity);
    expect(await child.evaluate(() => scrollY)).toBe(120);
  };
  await settings.click(); await preserved('settings');
  await settings.click(); await restored();
  const all = root.getByRole('button', { name: '所有书签', exact: true });
  await all.click(); await preserved('all-bookmarks');
  await address.click(); await restored();
  const bookmark = root.locator('.browser-bookmark-item').filter({ hasText: '测试页面' });
  await bookmark.click({ button: 'right' }); await preserved('bookmark-context');
  await page.getByRole('menuitem', { name: '编辑书签', exact: true }).click();
  await preserved('bookmark-editor');
  await page.getByRole('dialog', { name: '编辑书签', exact: true })
    .getByRole('button', { name: 'Close', exact: true }).click();
  await restored();
  const bounds = await bookmark.boundingBox();
  await bookmark.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0,
    clientX: bounds.x + 10, clientY: bounds.y + 10 });
  await expect(page.getByRole('menuitem', { name: '编辑书签', exact: true })).toBeVisible();
  await bookmark.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0 });
  await preserved('bookmark-long-press'); await address.click(); await restored();
  await settings.click(); await settings.click(); await settings.click(); await settings.click();
  await restored();
  console.log(`PASS ${label}: menus retain page, context menu and long-press match, no reload or lost draft/scroll`);
}

try {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().some(p => p.url().includes('website-tabs-harness'))).toBe(true);
  page = context.pages().find(p => p.url().includes('website-tabs-harness'));
  await context.addInitScript(origin => {
    for (const scope of ['bookmarks-local', 'bookmarks-remote', 'guest']) {
      localStorage.setItem(`remoteai:browser-bookmarks:${scope}`, JSON.stringify({ document: { revision: 0, entries: [
        { id: 'overlay-test', kind: 'link', title: '测试页面', url: `${origin}/`, parentId: '', position: 0 },
      ] } }));
    }
  }, origin);
  for (const mode of ['local', 'remote']) for (const narrow of [false, true]) {
    await page.setViewportSize({ width: narrow ? 1000 : 1440, height: 900 });
    await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}`
      + (narrow ? '&dark=1&font=20' : ''), { waitUntil: 'domcontentloaded' });
    const root = page.locator('.browser-main-page');
    await root.getByRole('textbox', { name: '页面地址', exact: true }).fill(origin);
    await root.getByRole('textbox', { name: '页面地址', exact: true }).press('Enter');
    await verifyMenus(root, await childPage(context), `windows-${mode}-${narrow ? 'dark-narrow' : 'light-wide'}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=local&native=1',
    { waitUntil: 'domcontentloaded' });
  await page.evaluate(async origin => {
    await window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request: { threadId: 'preview-thread',
      command: { action: 'open', url: `${origin}/managed`, requestId: crypto.randomUUID() } } });
  }, origin);
  await verifyMenus(page.locator('.website-preview-browser'), await childPage(context), 'windows-managed-light-wide');
} catch (error) {
  if (page) await shot('failure');
  throw error;
} finally {
  await browser?.close(); native.kill(); server.closeAllConnections(); server.close();
}
