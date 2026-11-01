import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: ['provider-market*.pw.ts', 'provider-browser.pw.ts', 'provider-icons.pw.ts'],
  workers: 1, timeout: 120_000,
  outputDir: '../../.codex-tmp/provider-market-browser',
  use: { baseURL: 'http://127.0.0.1:1499', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1280, height: 900 }, locale: 'en-US', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --config vite.provider-market.config.ts --host 127.0.0.1 --port 1499 --strictPort',
    url: 'http://127.0.0.1:1499', reuseExistingServer: !process.env.CI },
});
