import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'unified-account-picker.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/unified-account-picker', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1509', launchOptions: testBrowserLaunchOptions(),
    locale: 'zh-CN', viewport: { width: 1100, height: 800 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1509',
    url: 'http://127.0.0.1:1509', reuseExistingServer: false },
});
