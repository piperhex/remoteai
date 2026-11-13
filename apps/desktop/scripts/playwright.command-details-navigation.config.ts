import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'command-details-navigation.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/command-details-navigation-playwright',
  use: { baseURL: 'http://127.0.0.1:1578', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions(), screenshot: 'only-on-failure', isMobile: true, hasTouch: true },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1578 --strictPort',
    url: 'http://127.0.0.1:1578', reuseExistingServer: !process.env.CI },
});
