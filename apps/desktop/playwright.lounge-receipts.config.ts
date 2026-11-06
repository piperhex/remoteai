import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

process.env.LOUNGE_RECEIPT_WEB_URL = 'http://127.0.0.1:15986/web/';

export default defineConfig({
  testDir: './e2e', testMatch: 'lounge-receipt-rejection.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/lounge-receipt-playwright',
  use: { baseURL: 'http://127.0.0.1:15988', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions() },
  webServer: [
    { command: 'npx vite --host 127.0.0.1 --port 15988 --strictPort',
      url: 'http://127.0.0.1:15988', reuseExistingServer: false },
    { command: 'npx vite --config ../web/vite.config.ts --host 127.0.0.1 --port 15986 --strictPort',
      url: 'http://127.0.0.1:15986/web/', reuseExistingServer: false },
  ],
});
