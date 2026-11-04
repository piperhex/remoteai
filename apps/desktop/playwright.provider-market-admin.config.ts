import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: 'admin-provider-market-table.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../.codex-tmp/provider-market-table-evidence',
  use: { baseURL: 'http://127.0.0.1:1498', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', screenshot: 'only-on-failure' },
  webServer: { command: 'npm --prefix ../admin-ui run dev -- --port 1498 --strictPort',
    url: 'http://127.0.0.1:1498/admin.html', reuseExistingServer: !process.env.CI },
});
