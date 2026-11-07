import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'resource-navigation.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/resource-navigation',
  use: { baseURL: 'http://127.0.0.1:1568', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.resource-navigation.config.ts --host 127.0.0.1 --port 1568 --strictPort',
    url: 'http://127.0.0.1:1568', reuseExistingServer: true },
});
