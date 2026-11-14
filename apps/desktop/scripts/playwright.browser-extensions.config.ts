import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
export default defineConfig({
  testDir: '../e2e', testMatch: 'browser-extensions.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/browser-extensions-evidence',
  use: { baseURL: 'http://127.0.0.1:1582', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.browser-extensions.config.ts --port 1582 --strictPort',
    url: 'http://127.0.0.1:1582', reuseExistingServer: true },
});
