import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['browser-website-icons.pw.ts', 'browser-chrome.pw.ts'], workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/website-icons',
  use: { baseURL: 'http://127.0.0.1:1587', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.website-tabs.config.ts --host 127.0.0.1 --port 1587 --strictPort',
    url: 'http://127.0.0.1:1587', reuseExistingServer: true },
});
