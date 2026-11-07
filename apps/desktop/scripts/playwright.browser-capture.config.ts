import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'browser-capture.pw.ts', workers: 1, timeout: 30_000,
  outputDir: '../../../.codex-tmp/browser-capture-parity',
  use: { baseURL: 'http://127.0.0.1:1552', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.website-tabs.config.ts --host 127.0.0.1 --port 1552 --strictPort',
    url: 'http://127.0.0.1:1552', reuseExistingServer: true },
});
