import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: '**/mermaid.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../.codex-tmp/mermaid', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1496', headless: true, locale: 'zh-CN',
    viewport: { width: 1100, height: 800 }, launchOptions: testBrowserLaunchOptions() },
  webServer: { command: 'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1496 --strictPort',
    url: 'http://127.0.0.1:1496' },
});
