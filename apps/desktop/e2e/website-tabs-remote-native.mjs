import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const output = new URL('../../../.codex-tmp/website-tabs-native/', import.meta.url);
await mkdir(output, { recursive: true });
const request = async input => {
  const response = await fetch('http://127.0.0.1:1554/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
};
const browser = await chromium.launch(testBrowserLaunchOptions());
try {
  for (const mode of ['remote', 'web']) {
    const page = await browser.newPage({ viewport: { width: mode === 'remote' ? 1440 : 1024, height: 900 } });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    page.on('pageerror', error => console.error(error.message));
    const tabs = await request({ threadId: 'preview-thread', command: { action: 'list' } });
    const id = tabs.tabs[0].id;
    await page.goto(`http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=${mode}&automation=1&dark=1`,
      { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.website-browser-stream')).toBeVisible({ timeout: 15_000 });
    const snapshot = (await request({ threadId: 'preview-thread', tabId: id, command: { action: 'snapshot' } })).result;
    const reference = snapshot.elements.find(element => element.name === '备注').reference;
    await request({ threadId: 'preview-thread', tabId: id,
      command: { action: 'type', reference, text: `${mode} 同步预览已验证` } });
    const previous = await page.locator('.website-browser-stream').getAttribute('src');
    await expect.poll(() => page.locator('.website-browser-stream').getAttribute('src')).not.toBe(previous);
    await page.screenshot({ path: new URL(`${mode}-dark-ai-pointer.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    console.log(`${mode}: real native page, input and mouse indicator streamed to the shared sidebar`);
    await page.close();
  }
} finally { await browser.close(); }
