import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['activity-group-limit.pw.ts', 'activity-groups.pw.ts', 'activity-scrolling.pw.ts'],
  workers: 1, timeout: 45_000, outputDir: '../../../.codex-tmp/activity-group-playwright',
  use: { baseURL: 'http://127.0.0.1:1573', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions(), screenshot: 'only-on-failure' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1573 --strictPort',
    url: 'http://127.0.0.1:1573', reuseExistingServer: !process.env.CI },
});
