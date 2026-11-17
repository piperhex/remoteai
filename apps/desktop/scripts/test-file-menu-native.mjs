import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { testBrowserArguments, testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the native test executable; start Vite on port 1552.');
const keepOpen = process.argv.includes('--keep-open');
const expect = baseExpect.configure({ timeout: 15_000 });
const debugPort = 9361, origin = 'http://127.0.0.1:1552';
const output = new URL('../../../.codex-tmp/file-menu-overlay/', import.meta.url);
await mkdir(output, { recursive: true });

async function assertNativeRegion(popup, nativePid) {
  const expected = await popup.locator('.ant-dropdown,.ant-dropdown-menu-submenu-popup').evaluateAll(elements => {
    const rects = elements.map(element => element.getBoundingClientRect());
    return { left: Math.min(...rects.map(rect => rect.left)) * devicePixelRatio,
      top: Math.min(...rects.map(rect => rect.top)) * devicePixelRatio,
      right: Math.max(...rects.map(rect => rect.right)) * devicePixelRatio,
      bottom: Math.max(...rects.map(rect => rect.bottom)) * devicePixelRatio };
  });
  const probe = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(
    new URL('./browser-popup-region-probe.ps1', import.meta.url)), '-ProcessId', String(nativePid)],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '', error = '';
  probe.stdout.on('data', chunk => { text += chunk; });
  probe.stderr.on('data', chunk => { error += chunk; });
  probe.stdin.end('\n');
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.once('exit', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  const samples = JSON.parse(text.slice(text.indexOf('\n') + 1));
  expect(samples.length).toBeGreaterThan(20);
  for (const sample of samples) {
    expect(sample.Visible).toBe(true);
    expect(sample.Left).toBeLessThanOrEqual(expected.left);
    expect(sample.Top).toBeLessThanOrEqual(expected.top);
    expect(sample.Right).toBeGreaterThanOrEqual(expected.right);
    expect(sample.Bottom).toBeGreaterThanOrEqual(expected.bottom);
  }
}

async function verifyMenu({ main, popup, nativePid, label, local }) {
  const trigger = local ? main.getByRole('button', { name: '文件操作：C:/project/pda-build.exe', exact: true })
    : main.getByRole('button', { name: '文件操作：C:/project/report.pdf', exact: true });
  await trigger.click();
  await popup.getByRole('menuitem', { name: '打开方式', exact: true }).hover();
  const editor = popup.getByRole('menuitem', { name: 'VS Code', exact: true });
  await expect(editor).toBeVisible();
  await editor.hover();
  for (const menu of await popup.getByRole('menu').all()) {
    const bounds = await menu.boundingBox();
    const size = await popup.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
  }
  if (nativePid) await assertNativeRegion(popup, nativePid);
  await main.screenshot({ path: fileURLToPath(new URL(`${label}-owner.png`, output)), animations: 'disabled' });
  await popup.screenshot({ path: fileURLToPath(new URL(`${label}-submenu.png`, output)), animations: 'disabled' });
  await editor.click();
  await expect(main.getByLabel('操作结果')).toContainText('"application":"vscode"');
  await expect(popup.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  const submenuTitle = popup.getByRole('menuitem', { name: '打开方式', exact: true });
  // Let the opening motion finish before moving the pointer into a hover-triggered submenu.
  await expect(popup.locator('.ant-dropdown[class*="-enter"],.ant-dropdown[class*="-appear"]')).toHaveCount(0);
  await submenuTitle.click();
  await expect(editor).toBeVisible();
  await popup.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(popup.getByRole('menu')).toHaveCount(0);
  await verifyContextGestures(main, popup);
  if (!local) {
    await expect(main.getByRole('button', { name: '下载', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: '文件操作：C:/project/pda-build.exe', exact: true })).toHaveCount(0);
  }
  console.log(`PASS ${label}: submenu bounds, selection, click, Escape, right-click, long-press`);
}

async function verifyContextGestures(main, popup) {
  const link = main.getByRole('button', { name: '文件操作：C:/project/report.pdf', exact: true });
  await link.click({ button: 'right' });
  await expect(popup.getByRole('menuitem', { name: '打开方式', exact: true })).toBeVisible();
  const items = popup.locator('.ant-dropdown').getByRole('menuitem');
  const rightClickItems = await items.allTextContents();
  await popup.getByRole('menu').first().press('Escape');
  await expect(popup.getByRole('menu')).toHaveCount(0);
  const touch = { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0, clientX: 50, clientY: 40 };
  await link.dispatchEvent('pointerdown', touch);
  await expect(popup.getByRole('menuitem', { name: '打开方式', exact: true })).toBeVisible();
  await link.dispatchEvent('pointerup', touch);
  expect(await items.allTextContents()).toEqual(rightClickItems);
  await popup.getByRole('menu').first().press('Escape');
  await expect(popup.getByRole('menu')).toHaveCount(0);
}

const native = spawn(executable, ['provider_browser::automation::tests::opens_conversation_browser',
  '--ignored', '--nocapture'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
  BROWSER_TEST_IDENTIFIER: 'dev.codex.switch.file-menu-overlay-smoke',
  BROWSER_TEST_DEBUG_PORT: String(debugPort), BROWSER_TEST_CHILD_DEBUG_PORT: String(debugPort + 1),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let log = '', browser, web, main;
native.stdout.on('data', chunk => { log += chunk; });
native.stderr.on('data', chunk => { log += chunk; });
try {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  main = browser.contexts()[0].pages().find(page => page.url().includes('website-tabs-harness'));
  for (const mode of ['local', 'remote']) for (const narrow of [false, true]) {
    const label = `windows-${mode}-${narrow ? 'dark-narrow-font20' : 'light-wide-font14'}`;
    await main.goto(`${origin}/e2e/file-menu-overlay-harness.html?mode=${mode}` + (narrow ? '&dark&font=20' : ''));
    await main.evaluate(({ width, height }) => window.__TAURI_INTERNALS__.invoke('fixture_size', { width, height }),
      { width: narrow ? 760 : 1280, height: 900 });
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()))
      .some(page => page.url.startsWith('about:blank#remoteai-browser-overlay'))).toBe(true);
    await browser.close();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const pages = browser.contexts().flatMap(context => context.pages());
    main = pages.find(page => page.url().includes('file-menu-overlay-harness'));
    const popup = pages.find(page => page.url().startsWith('about:blank#remoteai-browser-overlay'));
    await verifyMenu({ main, popup, nativePid: native.pid, label, local: mode === 'local' });
  }
  web = await chromium.launch({ headless: true, ...testBrowserLaunchOptions() });
  const page = await web.newPage({ locale: 'zh-CN' });
  for (const narrow of [false, true]) {
    await page.setViewportSize({ width: narrow ? 760 : 1280, height: 900 });
    await page.goto(`${origin}/e2e/file-menu-overlay-harness.html?mode=web` + (narrow ? '&dark&font=20' : ''));
    await verifyMenu({ main: page, popup: page,
      label: `web-${narrow ? 'dark-narrow-font20' : 'light-wide-font14'}`, local: false });
  }
} catch (error) {
  if (main) await main.screenshot({ path: fileURLToPath(new URL('failure.png', output)) });
  throw error;
} finally {
  await writeFile(new URL('native.log', output), log);
  await web?.close(); await browser?.close();
  if (!keepOpen) native.kill(); else console.log('Retained native fixture PID', native.pid);
}
