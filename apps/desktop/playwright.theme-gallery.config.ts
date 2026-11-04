import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: ['theme-gallery.pw.ts', 'gui-skin.pw.ts'], workers: 1, timeout: 120_000,
  outputDir: '../../.codex-tmp/theme-gallery-tests',
  use: { baseURL: 'http://127.0.0.1:1583', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions() },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1583 --strictPort',
    url: 'http://127.0.0.1:1583', reuseExistingServer: false },
});
