import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { testBrowserArguments } from '../../scripts/test-browser.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd();
const output = `${root}/.codex-tmp/token-lifecycle`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = JSON.parse(readFileSync(`${root}/apps/desktop/src-tauri/tauri.conf.json`, 'utf8')).app.windows[0]
  .additionalBrowserArgs.split(' ');
const vite = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--config',
  'e2e/token-lifecycle.vite.ts', '--host', '127.0.0.1', '--port', '1544'],
{ cwd: `${root}/apps/desktop`, windowsHide: true, stdio: 'inherit' });
let native;
let browser;
const report = { runtime: 'Windows Tauri Wry/WebView2, isolated fixture, production window helper and ACL',
  observationMs: 5100, errors: [], sourceHashes: Object.fromEntries([
    'shared/token-usage/useWindowVisible.ts', 'shared/token-usage/useDocumentVisible.ts',
    'shared/token-usage/queryCache.ts',
    'apps/desktop/src/components/TokenUsagePanel.tsx',
    'apps/desktop/src/components/TokenUsageDashboard/useDashboardData.ts',
    'apps/desktop/src/components/TokenUsageDashboard/dashboardQuery.ts',
    'apps/web/src/chat/ChatTokenSummary.tsx',
  ].map(path => [path, createHash('sha256').update(readFileSync(`${root}/${path}`)).digest('hex')])) };
async function ready(url) {
  for (let attempt = 0; attempt < 450; attempt++) {
    if (await fetch(url).then(response => response.ok).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Fixture unavailable: ${url}`);
}
const counts = page => page.evaluate(() => ({ usage: { ...window.__tokenMetrics },
  state: { visible: window.__windowMetrics.visible, minimized: window.__windowMetrics.minimized } }));
function difference(after, before) {
  return Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
}
async function observe(pages) {
  const before = await Promise.all(pages.map(counts));
  const backend = await pages[0].evaluate(() => window.nativeCounts());
  await sleep(report.observationMs);
  const afterBackend = await pages[0].evaluate(() => window.nativeCounts());
  return { backendReads: afterBackend.map((value, index) => value - backend[index]),
    windows: await Promise.all(pages.map(async (page, index) => {
      const after = await counts(page);
      return { usage: difference(after.usage, before[index].usage),
        stateQueries: difference(after.state, before[index].state) };
    })) };
}
const zero = { entries: 0, daily: 0, breakdown: 0, quota: 0, renders: 0, draws: 0 };
function paused(value, stateQueriesAlsoPaused = false) {
  assert.deepEqual(value.backendReads, [0, 0, 0, 0]);
  for (const row of value.windows) {
    assert.deepEqual(row.usage, zero);
    if (stateQueriesAlsoPaused) assert.deepEqual(row.stateQueries, { visible: 0, minimized: 0 });
  }
}
const control = (page, label, action) => page.evaluate(({ label, action }) => window.nativeControl(label, action),
  { label, action });
async function pauseWindow(main, separate, action) {
  const pendingAtChange = await main.evaluate(() => window.usagePending());
  const before = await main.evaluate(() => window.nativeState());
  const countsBefore = await counts(main);
  const backendBefore = await main.evaluate(() => window.nativeCounts());
  const started = Date.now();
  await control(separate, 'main', action);
  await main.locator('canvas').first().waitFor({ state: 'detached', timeout: 4000 });
  const recognizedMs = Date.now() - started;
  const countsRecognized = await counts(main);
  const backendRecognized = await main.evaluate(() => window.nativeCounts());
  await main.waitForFunction(() => window.usagePending() === 0);
  return { before, after: await main.evaluate(() => window.nativeState()), pendingAtChange, recognizedMs,
    duringDetection: { usage: difference(countsRecognized.usage, countsBefore.usage),
      stateQueries: difference(countsRecognized.state, countsBefore.state),
      backendReads: backendRecognized.map((value, index) => value - backendBefore[index]) },
    stable: await observe([main]) };
}
async function resumeWindow(main, separate, action) {
  const started = Date.now();
  await control(separate, 'main', action);
  await main.locator('canvas').first().waitFor({ timeout: 4000 });
  return { recognizedMs: Date.now() - started, state: await main.evaluate(() => window.nativeState()),
    stable: await observe([main]) };
}
async function findWindow(label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      if (await page.evaluate(label => window.nativeLabel === label, label).catch(() => false)) return page;
    }
    await sleep(100);
  }
  throw new Error(`Window missing: ${label}`);
}
try {
  await ready('http://127.0.0.1:1544');
  native = spawn(`${output}/native-probe.exe`, [], { windowsHide: true, stdio: 'inherit', env: {
    ...process.env, WEBVIEW2_USER_DATA_FOLDER: `${output}/native-profile`,
    TOKEN_PROBE_BROWSER_ARGS: testBrowserArguments([...args, '--remote-debugging-port=1554']).join(' '),
  } });
  native.on('error', error => console.error('Native fixture start failed:', error));
  native.on('exit', (code, signal) => console.log('Native fixture exit:', code, signal));
  await ready('http://127.0.0.1:1554/json/version');
  browser = await chromium.connectOverCDP('http://127.0.0.1:1554');
  let pages;
  for (let attempt = 0; attempt < 150; attempt++) {
    pages = browser.contexts().flatMap(context => context.pages());
    if (pages.length === 2) break;
    await sleep(100);
  }
  assert.equal(pages.length, 2);
  for (const page of pages) {
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => !!window.nativeLabel && !!window.__tokenMetrics);
  }
  const labels = await Promise.all(pages.map(page => page.evaluate(() => window.nativeLabel)));
  const main = pages[labels.indexOf('main')];
  let separate = pages[labels.indexOf('token-usage')];
  report.services = await Promise.all(pages.map(page => page.evaluate(async () => ({
    label: window.nativeLabel, origin: location.origin, locks: !!navigator.locks, indexedDB: !!indexedDB,
    state: await window.nativeState(),
  }))));
  const key = `native-common:${Date.now()}`;
  report.sharedRead = await Promise.all(pages.map(page => page.evaluate(key => window.nativeQuery(key), key)));
  assert.deepEqual(report.sharedRead, [1, 1]);
  report.unvisited = await observe(pages);
  paused(report.unvisited, true);
  await main.getByRole('button', { name: 'Toggle usage' }).click();
  await main.locator('canvas').first().waitFor();
  report.open = await observe([main]);
  await main.screenshot({ path: `${output}/after-native-local-open.png` });
  console.log('NATIVE_LOCAL_OPEN', native.pid);
  if (process.env.TOKEN_NATIVE_SCREENSHOT_PAUSE) await sleep(15000);
  report.minimized = await pauseWindow(main, separate, 'minimize');
  paused(report.minimized.stable);
  report.restored = await resumeWindow(main, separate, 'restore');
  await main.screenshot({ path: `${output}/after-native-local-restored.png` });
  await control(separate, 'token-usage', 'focus');
  await main.waitForFunction(async () => !(await window.nativeState()).focused);
  report.hidden = await pauseWindow(main, separate, 'hide');
  assert.equal(report.hidden.before.focused, false);
  paused(report.hidden.stable);
  report.shown = await resumeWindow(main, separate, 'show');
  await main.screenshot({ path: `${output}/after-native-local-shown.png` });

  await main.evaluate(() => { window.__windowMetrics.delayMs = 2000; window.__windowMetrics.maxInFlight = 0; });
  await control(separate, 'main', 'focus');
  await main.waitForFunction(() => window.__windowMetrics.inFlight === 2);
  report.statePendingAtLeave = await main.evaluate(() => window.__windowMetrics.inFlight);
  await main.getByRole('button', { name: 'Toggle usage' }).click();
  await main.locator('canvas').first().waitFor({ state: 'detached' });
  await main.waitForFunction(() => window.usagePending() === 0);
  report.leftWhileStatePending = await observe([main]);
  paused(report.leftWhileStatePending, true);
  report.slowStateMaxInFlight = await main.evaluate(() => window.__windowMetrics.maxInFlight);
  assert.equal(report.slowStateMaxInFlight, 2);
  await main.evaluate(() => { window.__windowMetrics.delayMs = 0; });
  await main.getByRole('button', { name: 'Toggle usage' }).click();
  await main.locator('canvas').first().waitFor();
  await separate.getByRole('button', { name: 'Toggle usage' }).click();
  await separate.locator('canvas').first().waitFor();
  await sleep(500);
  report.both = await observe([main, separate]);
  assert.ok(report.both.backendReads.every(value => value <= 6));
  await separate.screenshot({ path: `${output}/after-native-independent-open.png` });
  report.pendingAtIndependentClose = await separate.evaluate(() => window.usagePending());
  await control(main, 'token-usage', 'destroy');
  await sleep(500);
  assert.ok(separate.isClosed());
  report.independentClosed = await observe([main]);
  await control(main, 'token-usage', 'reopen');
  separate = await findWindow('token-usage');
  await separate.getByRole('button', { name: 'Toggle usage' }).click();
  await separate.locator('canvas').first().waitFor();
  report.independentReopened = await observe([main, separate]);
  assert.ok(report.independentReopened.backendReads.every(value => value <= 6));
  await separate.screenshot({ path: `${output}/after-native-independent-reopened.png` });
  await separate.getByRole('button', { name: 'Toggle usage' }).click();
  await main.evaluate(() => { window.__tokenDelay = 3000; });
  await main.getByRole('button', { name: 'Refresh', exact: true }).last().click();
  await main.waitForFunction(() => window.usagePending() === 4);
  report.usagePendingAtNavigation = await main.evaluate(() => window.usagePending());
  const started = Date.now();
  await main.getByRole('button', { name: 'Toggle usage' }).click();
  await main.locator('canvas').first().waitFor({ state: 'detached' });
  report.navigationDuringPendingReadMs = Date.now() - started;
  await main.waitForFunction(() => window.usagePending() === 0);
  report.leftWhileUsagePending = await observe([main]);
  paused(report.leftWhileUsagePending, true);
  await main.goto('http://127.0.0.1:1544/e2e/token-remote-harness.html');
  await main.getByRole('button', { name: 'Open summary' }).click();
  await main.locator('.chat-token-card').first().waitFor();
  await sleep(500);
  await main.screenshot({ path: `${output}/after-native-remote-open.png` });
  await control(separate, 'main', 'minimize');
  await main.locator('.chat-token-card').first().waitFor({ state: 'detached' });
  const remoteBefore = await main.evaluate(() => window.remoteReadCount());
  await sleep(report.observationMs);
  report.remoteHiddenRequests = await main.evaluate(() => window.remoteReadCount()) - remoteBefore;
  assert.equal(report.remoteHiddenRequests, 0);
  assert.equal(await main.locator('.chat-token-card').count(), 0);
  await control(separate, 'main', 'restore');
  await main.locator('.chat-token-card').first().waitFor();
  await main.waitForFunction(before => window.remoteReadCount() > before, remoteBefore);
  await sleep(500);
  await main.screenshot({ path: `${output}/after-native-remote-restored.png` });
  assert.deepEqual(report.errors, []);
  report.success = true;
  console.log('NATIVE_PASS', JSON.stringify(report));
} finally {
  writeFileSync(`${output}/native.json`, JSON.stringify(report, null, 2));
  if (browser) {
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      if (await page.evaluate(() => !!window.nativeControl).catch(() => false)) {
        await page.evaluate(() => window.nativeControl('main', 'close')).catch(() => undefined);
        break;
      }
    }
    await browser.close().catch(() => undefined);
  }
  native?.kill();
  vite.kill();
}
