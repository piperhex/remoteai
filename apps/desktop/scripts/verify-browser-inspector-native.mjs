import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

const expect = playwrightExpect.configure({ timeout: 15_000 });

async function openContext(context, touch) {
  const child = context.pages().find(page => page.url().includes(':18316/'));
  if (!child) throw new Error('The inspector fixture page is missing.');
  const target = child.locator('#inspect-target');
  if (!touch) { await target.click({ button: 'right' }); return; }
  const box = await target.boundingBox();
  const session = await context.newCDPSession(child);
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await session.send('Input.synthesizeTapGesture', { x: box.x + 30, y: box.y + box.height / 2,
      duration: 1200, gestureSourceType: 'touch' });
  } finally { await session.detach(); }
}

const action = process.argv[2];
if (action === 'start') {
  const executable = process.argv[3];
  if (!executable) throw new Error('Pass the verified codex_switch_lib_tests executable.');
  const directory = new URL('../../../.codex-tmp/browser-inspector/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const fixture = fileURLToPath(new URL('inspector-smoke.exe', directory));
  await copyFile(executable, fixture);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><style>body{font:18px system-ui;padding:32px;background:#f4f7fa;color:#182230}'
      + 'h1{color:#6175db}input{padding:12px;font:inherit}</style><h1 id="inspect-target">Inspector test page</h1>'
      + '<p>Keep this page and its input while moving the inspector.</p><input aria-label="draft" value="retained">');
  });
  await new Promise(resolve => server.listen(18316, '127.0.0.1', resolve));
  const test = process.argv.includes('--managed') ? 'provider_browser::automation::tests::opens_conversation_browser'
    : 'provider_browser::inspector::tests::opens_inspector_browser';
  const native = spawn(fixture, [test,
    '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit', env: { ...process.env,
    BROWSER_TEST_DEBUG_PORT: '9343', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
  native.once('exit', code => { server.close(); process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { native.kill(); server.close(); });
} else {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9343');
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find(page => /:(1562|1552)\//.test(page.url()))
      ?? (action === 'open' ? context.pages().find(page => page.url() === 'chrome-error://chromewebdata/') : undefined);
    if (!page) throw new Error('Start the native fixture and Vite on port 1562 first.');
    page.setDefaultTimeout(20_000);
    if (action === 'open') {
      const mode = process.argv[3] ?? 'local';
      if (process.argv.includes('--managed')) {
        await page.goto(`http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=${mode}&native=1`);
        await expect(page.getByRole('heading', { name: '网页预览' })).toBeVisible();
        await page.evaluate(async () => {
          const request = command => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', {
            request: { threadId: 'preview-thread', ...command },
          });
          const previous = await request({ command: { action: 'list' } });
          for (const tab of previous.tabs ?? []) await request({ tabId: tab.id, command: { action: 'close' } });
          await request({ command: { action: 'open', requestId: crypto.randomUUID(),
            url: 'http://127.0.0.1:18316/' } });
        });
      } else {
      await page.goto(`http://127.0.0.1:1562/e2e/browser-bookmarks-harness.html?mode=${mode}`
        + (process.argv.includes('--dark') ? '&dark=1&font=20' : ''));
      const address = page.locator('.pm-browser-toolbar input');
      await address.fill('http://127.0.0.1:18316/'); await address.press('Enter');
      }
      await expect.poll(() => context.pages().some(page => page.url().includes(':18316/'))).toBe(true);
      await openContext(context, process.argv.includes('--touch'));
      console.log('Native context menu is open; select Inspect through the Windows UI.');
    } else if (action === 'context') {
      await openContext(context, process.argv.includes('--touch'));
      console.log('Native context menu requested. Use its Inspect command through the Windows UI.');
    } else if (action === 'tabs') {
      const original = page.getByRole('tab', { name: '127.0.0.1', exact: true }).first();
      await page.getByRole('button', { name: '新标签页', exact: true }).click();
      await expect(page.locator('.browser-inspector-panel:visible')).toHaveCount(0);
      await original.click();
      await expect(page.locator('.browser-inspector-panel:visible')).toHaveCount(1);
      const address = page.locator('.pm-browser-toolbar input');
      await address.fill('http://127.0.0.1:18316/?navigated'); await address.press('Enter');
      await expect.poll(() => context.pages().some(page => page.url().includes('?navigated'))).toBe(true);
      await expect(page.locator('.browser-inspector-panel:visible')).toHaveCount(1);
      console.log('Inspector survives tab switching and page navigation.');
    } else if (['right', 'bottom', 'window'].includes(action)) {
      await expect(page.locator('.browser-inspector-panel')).toBeVisible();
      await page.locator('.browser-inspector-toolbar button').nth(['right', 'bottom', 'window'].indexOf(action)).click();
      await expect(page.locator('.browser-inspector-layout')).toHaveAttribute('data-dock', action);
      const child = context.pages().find(page => page.url().includes(':18316/'));
      await expect(child.getByRole('textbox', { name: 'draft' })).toHaveValue('retained');
      console.log(JSON.stringify({ mode: action, page: await child.evaluate(() => ({
        width: innerWidth, height: innerHeight, url: location.href })),
        pane: await page.locator('.browser-inspector-native').boundingBox() }));
    } else if (action === 'resize') {
      const splitter = page.locator('.browser-inspector-splitter');
      await splitter.focus();
      const vertical = await splitter.getAttribute('aria-orientation') === 'vertical';
      const previous = Number(await splitter.getAttribute('aria-valuenow'));
      await splitter.press(vertical ? 'ArrowLeft' : 'ArrowUp');
      await expect(splitter).toHaveAttribute('aria-valuenow', String(previous + 2));
      const box = await splitter.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - (vertical ? 100 : 0),
        box.y + box.height / 2 - (vertical ? 0 : 80), { steps: 15 });
      await page.mouse.up();
      await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(previous + 2);
      console.log('Keyboard and pointer splitter resize passed.');
    } else if (action === 'close') {
      await page.locator('.browser-inspector-toolbar button').last().click();
      await expect(page.locator('.browser-inspector-panel')).toHaveCount(0);
      console.log('Inspector closed; browser surface restored.');
    } else throw new Error('Use start, open, context, tabs, right, bottom, window, resize or close.');
  } finally { await browser.close(); }
}
