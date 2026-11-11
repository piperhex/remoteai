import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: '**/computer-use-admin.pw.ts', workers: 1, timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: '../../../.codex-tmp/computer-use-admin-playwright',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1512',
    viewport: { width: 960, height: 760 }, locale: 'zh-CN', headless: true },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.computer-use-admin.config.ts --port 1512 --strictPort',
    url: 'http://127.0.0.1:1512', reuseExistingServer: !process.env.CI },
});
