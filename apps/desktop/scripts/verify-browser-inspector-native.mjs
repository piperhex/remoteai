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

async function verifyPlacementDeduplication(page) {
  await expect(page.locator('.browser-inspector-panel')).toBeVisible();
  await page.waitForTimeout(300);
  const calls = await page.evaluate(async () => {
    const bridge = window.__TAURI_INTERNALS__;
    const original = bridge.invoke;
    let placements = 0;
    bridge.invoke = function (command, args, ...rest) {
      if (command === 'browser_inspector' && args?.request?.command?.action === 'place') placements++;
      return original.call(this, command, args, ...rest);
    };
    const node = document.createElement('span'); node.hidden = true;
    document.body.append(node);
    try {
      for (let index = 0; index < 60; index++) {
        node.textContent = String(index);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      return placements;
    } finally { node.remove(); bridge.invoke = original; }
  });
  expect(calls).toBe(0);
  console.log('60 unrelated DOM updates produced 0 native inspector placement calls.');
}

async function verifyDeviceCycle(page, child) {
  const toggle = page.getByRole('button', { name: '手机模式' });
  const draft = child.getByRole('textbox', { name: 'draft' });
  const device = () => child.evaluate(() => ({
    touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, start: performance.timeOrigin,
  }));
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.browser-inspector-toolbar')).toHaveText('');
  const desktop = await device();
  const width = await child.evaluate(() => innerWidth);
  await draft.fill('edited');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Math.round((await page.locator('.pm-browser-surface:visible').boundingBox()).width))
    .toBeLessThanOrEqual(390);
  expect(await device()).toMatchObject({ coarse: true, start: desktop.start });
  await child.evaluate(() => document.addEventListener('pointerdown', event => {
    document.body.dataset.pointer = event.pointerType;
  }));
  // A docked WebView2 can deliver input without acknowledging the CDP click.
  const clickAs = async type => {
    const pointer = child.waitForFunction(expected => document.body.dataset.pointer === expected, type);
    await Promise.race([draft.click(), pointer]);
    await pointer;
  };
  await clickAs('touch');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(device).toEqual(desktop);
  await expect.poll(() => child.evaluate(() => innerWidth)).toBe(width);
  await clickAs('mouse');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.browser-inspector-toolbar button').last().click();
  await expect(toggle).toHaveCount(0);
  await expect.poll(device).toEqual(desktop);
  await expect(draft).toHaveValue('edited');
  console.log('Verified mobile and desktop pointer input, viewport restoration, retained edits and inspector close.');
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
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>body{font:18px system-ui;padding:32px;background:#f4f7fa;color:#182230}'
      + 'h1{color:#6175db}input{padding:12px;font:inherit}</style><h1 id="inspect-target">Inspector test page</h1>'
      + '<p>Keep this page and its input while moving the inspector.</p><input aria-label="draft" value="retained">');
  });
  await new Promise(resolve => server.listen(18316, '127.0.0.1', resolve));
  const test = process.argv.includes('--managed') ? 'provider_browser::automation::tests::opens_conversation_browser'
    : 'provider_browser::inspector::tests::opens_inspector_browser';
  const native = spawn(fixture, [test,
    '--ignored', '--nocapture'], { windowsHide: true, stdio: 'inherit', env: { ...process.env,
    BROWSER_TEST_DEBUG_PORT: '9343', BROWSER_TEST_CHILD_DEBUG_PORT: '9344',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
  native.once('exit', code => { server.close(); process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { native.kill(); server.close(); });
} else {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9343');
  let children;
  try {
    const host = browser.contexts()[0];
    const page = host.pages().find(page => /:(1562|1552)\//.test(page.url()))
      ?? (action === 'open' ? host.pages().find(page => page.url() === 'chrome-error://chromewebdata/') : undefined);
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
    }
    await expect.poll(async () => {
      try { return (await fetch('http://127.0.0.1:9344/json/version')).ok; } catch { return false; }
    }).toBe(true);
    children = await chromium.connectOverCDP('http://127.0.0.1:9344');
    const context = children.contexts()[0];
    if (action === 'open') {
      await expect.poll(() => context.pages().some(page => page.url().includes(':18316/'))).toBe(true);
      if (process.argv.includes('--device-test')) {
        const tab = page.locator('.pm-browser-page:visible').first();
        const id = (await tab.getAttribute('id')).replace(/^page-/, '');
        await page.evaluate(request => window.__TAURI_INTERNALS__.invoke('open_inspector_fixture', { request }),
          { id, kind: process.argv.includes('--managed') ? 'conversation' : 'provider', command: { action: 'status' } });
        await expect(page.locator('.browser-inspector-toolbar')).toBeVisible();
      } else {
        await openContext(context, process.argv.includes('--touch'));
        console.log('Native context menu is open; select Inspect through the Windows UI.');
      }
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
      await page.locator('.browser-inspector-toolbar').getByRole('group').getByRole('button')
        .nth(['right', 'bottom', 'window'].indexOf(action)).click();
      await expect(page.locator('.browser-inspector-layout')).toHaveAttribute('data-dock', action);
      const child = context.pages().find(page => page.url().includes(':18316/'));
      await expect(child.getByRole('textbox', { name: 'draft' })).toHaveValue('retained');
      console.log(JSON.stringify({ mode: action, page: await child.evaluate(() => ({
        width: innerWidth, height: innerHeight, url: location.href })),
        pane: await page.locator('.browser-inspector-native').boundingBox() }));
    } else if (['mobile', 'desktop'].includes(action)) {
      const mobile = action === 'mobile';
      const toggle = page.getByRole('button', { name: '手机模式' });
      const child = context.pages().find(page => page.url().includes(':18316/'));
      if ((await toggle.getAttribute('aria-pressed') === 'true') !== mobile) await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', String(mobile));
      const surface = page.locator('.pm-browser-surface:visible');
      await expect.poll(async () => Math.abs((await surface.boundingBox()).width
        - await child.evaluate(() => innerWidth))).toBeLessThanOrEqual(1);
      if (mobile) {
        expect(Math.round((await surface.boundingBox()).width)).toBeLessThanOrEqual(390);
        expect(await child.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      }
      await expect(child.getByRole('textbox', { name: 'draft' })).toHaveValue('retained');
      console.log(await child.evaluate(() => ({ width: innerWidth, height: innerHeight,
        touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches })));
    } else if (action === 'device-cycle') {
      await verifyDeviceCycle(page, context.pages().find(page => page.url().includes(':18316/')));
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
    } else if (action === 'dedupe') {
      await verifyPlacementDeduplication(page);
    } else if (action === 'close') {
      await page.locator('.browser-inspector-toolbar button').last().click();
      await expect(page.locator('.browser-inspector-panel')).toHaveCount(0);
      console.log('Inspector closed; browser surface restored.');
    } else throw new Error('Unknown inspector verification action: ' + action);
  } finally { await children?.close(); await browser.close(); }
}
