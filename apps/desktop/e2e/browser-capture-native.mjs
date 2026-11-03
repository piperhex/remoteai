import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../../../.codex-tmp/browser-capture/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
const page = browser.contexts()[0].pages().find(page => page.url().includes('website-tabs-harness'));
if (!page) throw new Error('Browser capture fixture not found');
const tool = params => page.evaluate(params => window.__TAURI_INTERNALS__.invoke('browser_capture_tool', { params }), params);
const threadId = 'capture-verification';
const command = (tabId, action) => tool({ name: 'gui_browser_use', arguments: { threadId, tabId, command: { action } } });
let tabId;
try {
  const opened = await tool({ name: 'gui_browser_open', arguments: {
    threadId, requestId: 'capture-smoke', url: 'http://127.0.0.1:1553/preview-site/capture',
  } });
  expect(opened.isError).toBe(false);
  tabId = opened.structuredContent.tab.id;
  await expect.poll(async () => JSON.stringify((await command(tabId, 'snapshot')).structuredContent))
    .toContain('capture');
  const captured = await command(tabId, 'screenshot');
  expect(captured.isError).toBe(false);
  const { screenshot } = captured.structuredContent.result;
  expect(screenshot.markdown).toBe(`![](<${screenshot.path}>)`);
  const image = captured.content.find(part => part.type === 'image');
  expect((await readFile(screenshot.path)).equals(Buffer.from(image.data, 'base64'))).toBe(true);
  const polling = await page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }), {
    threadId, tabId, command: { action: 'screenshot' },
  });
  expect(polling.result.screenshot).toBeUndefined();
  expect(polling.result.image.data.length).toBeGreaterThan(1000);
  expect((await command(tabId, 'close')).isError).toBe(false);
  tabId = undefined;
  expect((await readFile(screenshot.path)).length).toBeGreaterThan(1000);
  await writeFile(new URL('capture.json', output), JSON.stringify(captured));
  await writeFile(new URL('windows-built-in-capture.jpg', output), Buffer.from(image.data, 'base64'));
  await page.screenshot({ path: fileURLToPath(new URL('windows-native-after-close.png', output)) });
  console.log('Native MCP capture persists a reply image after tab closure; preview polling stays memory-only.');
} finally {
  if (tabId) await command(tabId, 'close');
  await browser.close();
}
