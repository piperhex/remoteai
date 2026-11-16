import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments, testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { navigationFixture } from './browser-navigation-fixture.mjs';

// Build codex_switch_lib_tests and run Vite with scripts/vite.website-tabs.config.ts on port 1552 first.
const executable = process.argv[2];
if (!executable) throw new Error('Pass the codex_switch_lib_tests executable path.');
const expect = baseExpect.configure({ timeout: 15_000 });
const origin = 'http://127.0.0.1:18316';
const harness = 'http://127.0.0.1:1552';
const debugPort = '9347';
const childDebugPort = '9348';
const output = new URL('../../../.codex-tmp/browser-navigation-native/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = await navigationFixture(new URL(origin).port);
const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit', env: { ...process.env,
  BROWSER_TEST_DEBUG_PORT: debugPort, BROWSER_TEST_CHILD_DEBUG_PORT: childDebugPort,
  BROWSER_TEST_IDENTIFIER: `dev.codex.switch.navigation-${Date.now()}`,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
let children;
let page;
try {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await expect.poll(() => {
    page = context.pages().find(entry => entry.url().includes('website-tabs-harness')); return Boolean(page);
  }).toBe(true);
  page.on('pageerror', error => console.error('Native page:', error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.error('Native console:', message.text());
  });
  const childContext = async () => {
    if (!children) children = await chromium.connectOverCDP(`http://127.0.0.1:${childDebugPort}`);
    return children.contexts()[0];
  };
  for (const sidebar of [false, true]) await verifyManual({ page, childContext, sidebar });
  await verifyManaged({ page, context: await childContext() });
  console.log('PASS: native menu/sidebar, managed local/remote/web, history, hashes, frames, loading and reloads.');
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => ({ native: Boolean(window.__TAURI_INTERNALS__),
      text: document.body.innerText, frames: document.querySelectorAll('iframe').length })));
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) });
  }
  throw error;
} finally {
  await children?.close(); await browser?.close(); native.kill(); fixture.close();
}

function addressOf(page) { return page.getByRole('textbox', { name: '页面地址', exact: true }); }
function chromeOf(page) { return page.locator('.browser-main-page, .website-preview-browser'); }
async function childAt(context, url) {
  await expect.poll(() => context.pages().map(entry => entry.url())).toContain(url);
  return context.pages().find(entry => entry.url() === url);
}
async function capture(page, label) {
  await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), animations: 'disabled' });
  await fixture.capture(label);
}

async function expectState({ page, child, path, timeOrigin, loading = false }) {
  await expect(addressOf(page)).toHaveValue(`${origin}${path}`);
  await expect.poll(() => child.url()).toBe(`${origin}${path}`);
  await expect(child.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('retained');
  expect(await child.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  await expect(chromeOf(page).getByRole('button', { name: loading ? '取消' : '刷新', exact: true })).toBeVisible();
}

async function verifyHistory({ page, child, label, initial = '/start', registry }) {
  await child.getByRole('textbox', { name: 'Draft', exact: true }).fill('retained');
  const timeOrigin = await child.evaluate(() => performance.timeOrigin);
  const state = async (path, loading = false) => {
    await expectState({ page, child, path, timeOrigin, loading });
    if (registry) await expect.poll(registry).toMatchObject({ url: `${origin}${path}`, loading });
  };
  await child.getByRole('button', { name: 'Push path', exact: true }).click();
  await state('/spa/pushed?view=1');
  await child.getByRole('button', { name: 'Replace path', exact: true }).click();
  await state('/spa/replaced?view=2');
  await capture(page, `${label}-replace`);
  await child.getByRole('button', { name: 'Change hash', exact: true }).click();
  await state('/spa/replaced?view=2#details');
  await chromeOf(page).getByRole('button', { name: '后退', exact: true }).click();
  await state('/spa/replaced?view=2');
  await chromeOf(page).getByRole('button', { name: '后退', exact: true }).click();
  await state(initial);
  await chromeOf(page).getByRole('button', { name: '前进', exact: true }).click();
  await state('/spa/replaced?view=2');
  await chromeOf(page).getByRole('button', { name: '前进', exact: true }).click();
  await state('/spa/replaced?view=2#details');
  await child.getByRole('button', { name: 'Change frame path', exact: true }).click();
  await child.getByRole('button', { name: 'Invalid origin', exact: true }).click();
  expect(await child.evaluate(() => window.navigationError)).toBe('SecurityError');
  await state('/spa/replaced?view=2#details');
  await capture(page, `${label}-history`);
}

async function verifyManual({ page, childContext, sidebar }) {
  const label = `windows-local-${sidebar ? 'sidebar' : 'menu'}`;
  await page.goto(`${harness}/e2e/browser-bookmarks-harness.html?${sidebar ? 'sidebar=1&dark=1' : ''}`);
  await addressOf(page).fill(`${origin}/start`); await addressOf(page).press('Enter');
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${childDebugPort}/json/version`)).ok; } catch { return false; }
  }).toBe(true);
  const child = await childAt(await childContext(), `${origin}/start`);
  await verifyHistory({ page, child, label });
  await chromeOf(page).getByRole('button', { name: '刷新', exact: true }).click();
  await expect(child.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('original');
  await expect(addressOf(page)).toHaveValue(`${origin}/spa/replaced?view=2#details`);
  await addressOf(page).fill(`${origin}/slow`); await addressOf(page).press('Enter');
  await expect.poll(() => fixture.pending.size).toBe(1);
  await child.getByRole('textbox', { name: 'Draft', exact: true }).fill('retained');
  const timeOrigin = await child.evaluate(() => performance.timeOrigin);
  await child.getByRole('button', { name: 'Push path', exact: true }).click();
  await expectState({ page, child, path: '/spa/pushed?view=1', timeOrigin, loading: true });
  fixture.release();
  await expect(chromeOf(page).getByRole('button', { name: '刷新', exact: true })).toBeVisible();
  console.log(`PASS: ${label}`);
}

async function verifyManaged({ page, context }) {
  await page.goto(`${harness}/e2e/website-tabs-harness.html?mode=local`);
  const request = value => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }),
    { threadId: 'preview-thread', ...value });
  const opened = await request({ command: { action: 'open', url: `${origin}/managed`,
    requestId: `navigation-${Date.now()}`, destination: 'agentHub' } });
  const child = await childAt(context, `${origin}/managed`);
  const registry = async () => (await request({ command: { action: 'list' } })).tabs
    .find(tab => tab.id === opened.tab.id);
  await verifyHistory({ page, child, label: 'windows-local-managed', initial: '/managed', registry });
  const remote = await chromium.launch(testBrowserLaunchOptions());
  try {
    for (const mode of ['remote', 'web']) {
      await request({ tabId: opened.tab.id, command: { action: 'navigate', url: `${origin}/${mode}` } });
      await expect.poll(() => child.url()).toBe(`${origin}/${mode}`);
      const client = await remote.newPage({ viewport: { width: mode === 'remote' ? 1440 : 1024, height: 900 } });
      await connectRemote(client, request);
      await client.goto(`${harness}/e2e/website-tabs-harness.html?mode=${mode}&automation=1&dark=1`);
      await expect(client.locator('.website-browser-stream')).toBeVisible();
      await verifyHistory({ page: client, child, label: `windows-${mode}`, initial: `/${mode}`, registry });
      await client.close();
      console.log(`PASS: ${mode}`);
    }
  } finally { await remote.close(); }
  await request({ tabId: opened.tab.id, command: { action: 'close' } });
}

async function connectRemote(page, request) {
  await page.route('http://127.0.0.1:1554/request', async route => {
    const headers = { 'Access-Control-Allow-Origin': harness, 'Access-Control-Allow-Headers': 'Content-Type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    await route.fulfill({ headers, json: await request(route.request().postDataJSON()) });
  });
}
