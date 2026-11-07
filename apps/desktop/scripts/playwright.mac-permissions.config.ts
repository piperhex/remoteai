import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: '**/mac-permissions.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/mac-permissions-playwright',
  use: {
    launchOptions: testBrowserLaunchOptions(),
    baseURL: 'http://127.0.0.1:1496', locale: 'zh-CN', headless: true },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1496 --strictPort',
    url: 'http://127.0.0.1:1496', reuseExistingServer: !process.env.CI },
});
