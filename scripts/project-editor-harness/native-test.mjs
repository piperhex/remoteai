import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { testBrowserArguments, testBrowserLaunchOptions } from '../test-browser.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, '.codex-tmp/project-editor');
const directory = resolve(evidence, 'native-files');
mkdirSync(directory, { recursive: true });
const original = resolve(evidence, 'project-256/large.log');
const file = resolve(directory, 'large.ts');
const log = createWriteStream(resolve(evidence, 'native-runtime.log'));
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
  '--config', 'scripts/vite.project-editor.config.ts', '--host', '127.0.0.1', '--port', '1496'],
  { cwd: resolve(root, 'apps/desktop'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
let app;
let browser;
let page;
async function ready(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* fixture process is starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Fixture did not start: ${url}`);
}
try {
  copyFileSync(original, file);
  await ready('http://127.0.0.1:1496');
  app = spawn(resolve(evidence, 'native-probe.exe'), [], { cwd: root, windowsHide: true,
    env: { ...process.env, PROJECT_EDITOR_PROBE_ROOT: directory,
      PROJECT_EDITOR_PROBE_PROFILE: resolve(evidence, 'native-profile'),
      PROJECT_EDITOR_PROBE_BROWSER_ARGS: testBrowserArguments([
        ...testBrowserLaunchOptions().args, '--remote-debugging-port=1548',
        '--remote-debugging-address=127.0.0.1',
      ]).join(' ') }, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.pipe(log, { end: false }); app.stderr.pipe(log, { end: false });
  await ready('http://127.0.0.1:1548/json/version');
  browser = await chromium.connectOverCDP('http://127.0.0.1:1548');
  const context = browser.contexts()[0];
  await context.addInitScript(() => {
    localStorage.setItem('codex-switch.project-browser.auto-save', '0');
    localStorage.setItem('codex-switch:language', 'zh');
  });
  page = context.pages()[0] ?? await context.waitForEvent('page');
  const results = [];
  for (const mode of ['local', 'remote', 'web']) {
    copyFileSync(original, file);
    await page.goto(`http://127.0.0.1:1496/e2e/project-browser-harness.html?mode=${mode}&largeText=1&editorService=1`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await page.evaluate(() => {
      window.editorProbeTicks = [performance.now()];
      window.editorProbeTimer = setInterval(() => window.editorProbeTicks.push(performance.now()), 25);
    });
    const start = performance.now();
    await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
    await expect(editor).toContainText('reproducible log entry', { timeout: 120_000 });
    const readyMs = performance.now() - start;
    const ticks = await page.evaluate(() => {
      clearInterval(window.editorProbeTimer);
      return [...window.editorProbeTicks, performance.now()];
    });
    await page.screenshot({ path: resolve(evidence, `native-windows-${mode}-initial.png`) });
    await editor.press('Control+Home');
    await page.keyboard.insertText('keep-native-draft');
    writeFileSync(file, 'external change');
    await page.evaluate(() => {
      window.editorProbeTicks = [performance.now()];
      window.editorProbeTimer = setInterval(() => window.editorProbeTicks.push(performance.now()), 25);
    });
    const conflictStart = performance.now();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('文件已在其他地方修改', { timeout: 120_000 });
    const conflictMs = performance.now() - conflictStart;
    const saveTicks = await page.evaluate(() => {
      clearInterval(window.editorProbeTimer);
      return [...window.editorProbeTicks, performance.now()];
    });
    await expect(editor).toContainText('keep-native-draft');
    await page.screenshot({ path: resolve(evidence, `native-windows-${mode}-conflict.png`) });
    results.push({ mode, readyMs, conflictMs, tickCount: ticks.length, saveTickCount: saveTicks.length,
      maxTimerGapMs: Math.max(0, ...ticks.slice(1).map((value, index) => value - ticks[index])),
      saveMaxTimerGapMs: Math.max(0, ...saveTicks.slice(1).map((value, index) => value - saveTicks[index])) });
    writeFileSync(resolve(evidence, 'native-windows-results.json'), JSON.stringify(results, null, 2));
  }
  writeFileSync(resolve(evidence, 'native-windows-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (process.env.PROJECT_EDITOR_PROBE_KEEP_OPEN === '1') {
    console.log('NATIVE_PROBE_READY_FOR_SCREENSHOT');
    await new Promise(resolve => setTimeout(resolve, 45_000));
  }
  // The exit command destroys the invoking WebView before its promise can always settle.
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('close_probe')).catch(() => {});
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(evidence, 'native-windows-failed.png') }).catch(() => {});
    writeFileSync(resolve(evidence, 'native-windows-failed.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  await browser?.close();
  if (app && app.exitCode === null) app.kill();
  if (server.exitCode === null) server.kill();
  log.end();
}
