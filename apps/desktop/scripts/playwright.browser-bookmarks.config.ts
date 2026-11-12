import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'browser-bookmarks.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/browser-bookmarks-evidence',
  use: { baseURL: 'http://127.0.0.1:1578', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.browser-bookmarks.config.ts --host 127.0.0.1 --port 1578 --strictPort',
    url: 'http://127.0.0.1:1578', reuseExistingServer: true },
});
