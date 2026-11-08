import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'pdf-routing.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/pdf-routing-desktop', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1578', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.website-tabs.config.ts --host 127.0.0.1 --port 1578 --strictPort',
    url: 'http://127.0.0.1:1578', reuseExistingServer: true },
});
