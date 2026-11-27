import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { testBrowserArguments } from '../../../scripts/test-browser.mjs';

// Run Vite on port 1552 and pass the desktop Rust test executable as the first argument.
const received = new Set();
const server = createServer((request, response) => {
  received.add(request.headers.host + request.url);
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<title>设计预览</title><style>body{font:16px system-ui;padding:32px;color:#23372f}</style>'
    + '<h1>设计预览</h1><code></code><script>document.querySelector("code").textContent=location.host</script>');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const output = new URL('../../../.codex-tmp/local-mapping-browser/', import.meta.url);
await mkdir(output, { recursive: true });
const runtime = spawn(process.argv[2], ['provider_browser::automation::tests::opens_conversation_browser', '--ignored'],
  { windowsHide: true, stdio: 'inherit', env: { ...process.env, BROWSER_TEST_DEBUG_PORT: '9343',
    BROWSER_TEST_CHILD_DEBUG_PORT: '9344', BROWSER_TEST_IDENTIFIER: 'dev.codex.switch.local-mapping-test',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments().join(' ') } });
let browser;
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9343/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9343');
  const page = browser.contexts()[0].pages()[0];
  const domains = ['localhost', 'design.test', 'design.localhost'];
  const routes = domains.map(domain => ({ domain, port: 18308, target: `127.0.0.1:${server.address().port}` }));
  for (const mode of ['local', 'remote']) {
    await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}`);
    await page.evaluate(routes => window.__TAURI_INTERNALS__.invoke('configure_browser_mappings', { routes }), routes);
    const address = page.getByLabel('页面地址', { exact: true });
    for (const domain of domains) {
      const path = `${domain}:18308/${mode}`;
      await address.fill('http://' + path);
      await address.press('Enter');
      await expect.poll(() => received.has(path), { message: path, timeout: 30_000 }).toBe(true);
    }
    await expect(page.locator('.browser-main-page')).toContainText('设计预览');
    const control = await page.getByRole('tab', { selected: true }).getAttribute('aria-controls');
    const image = await page.evaluate(id => window.__TAURI_INTERNALS__.invoke('provider_browser_preview', { id }),
      control.replace(/^page-/, ''));
    await writeFile(new URL(`windows-${mode}-mapped-site.jpg`, output), Buffer.from(image.data, 'base64'));
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('configure_browser_mappings', { routes: [] }));
  }
  console.log('Verified the HTTP Host and destination port for all six native browser navigations.');
} finally {
  await browser?.close();
  runtime.kill();
  server.closeAllConnections();
  server.close();
}
