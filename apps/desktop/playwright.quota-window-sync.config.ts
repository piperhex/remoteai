import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: '**/quota-window-sync.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../.codex-tmp/quota-window-sync', reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1488', headless: true, locale: 'zh-CN',
    viewport: { width: 1100, height: 800 }, launchOptions: testBrowserLaunchOptions(),
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --config e2e/quota-window-sync.vite.config.ts '
      + '--host 127.0.0.1 --port 1488 --strictPort',
    url: 'http://127.0.0.1:1488',
  },
});
