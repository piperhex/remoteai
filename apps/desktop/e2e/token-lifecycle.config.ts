import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
export default defineConfig({
  testDir: '.', testMatch: ['token-lifecycle.pw.ts', 'token-query.pw.ts', 'token-remote.pw.ts'],
  workers: 1, timeout: 180_000,
  outputDir: '../../../.codex-tmp/token-lifecycle/playwright',
  use: { baseURL: 'http://127.0.0.1:1544', headless: true, actionTimeout: 15000,
    launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npx vite --config e2e/token-lifecycle.vite.ts --host 127.0.0.1 --port 1544',
    url: 'http://127.0.0.1:1544', reuseExistingServer: false, timeout: 180_000, stdout: 'pipe', stderr: 'pipe' },
});
