import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

// Run against the production build so render timings exclude development transforms.
export default defineConfig({
  testDir: '.', testMatch: 'navigation-retention.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/tab-retention/desktop',
  use: { baseURL: 'http://127.0.0.1:1493', headless: true, launchOptions: testBrowserLaunchOptions() },
  webServer: { command: 'npx vite preview --config scripts/vite.config.ts --host 127.0.0.1 --port 1493 --strictPort',
    url: 'http://127.0.0.1:1493', reuseExistingServer: true },
});
