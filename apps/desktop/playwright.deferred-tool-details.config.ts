import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: 'deferred-tool-details.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/deferred-tool-details-playwright',
  use: { headless: true, launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN',
    navigationTimeout: 60_000, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-local', use: { baseURL: 'http://127.0.0.1:1536', viewport: { width: 1280, height: 900 } } },
    { name: 'desktop-remote', use: { baseURL: 'http://127.0.0.1:1536', viewport: { width: 1280, height: 900 } } },
    { name: 'web-desktop', use: { baseURL: 'http://127.0.0.1:1537/web/', viewport: { width: 1280, height: 900 } } },
    { name: 'web-mobile', use: { baseURL: 'http://127.0.0.1:1537/web/', viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'npx vite --config e2e/deferred-tool-details.vite.ts --port 1536',
      url: 'http://127.0.0.1:1536/deferred-tool-details-harness.html', timeout: 120_000 },
    { command: 'npx vite --config e2e/deferred-tool-details.vite.ts --port 1537', env: { TOOL_DETAILS_TEST_APP: 'web' },
      url: 'http://127.0.0.1:1537/web/deferred-tool-details-harness.html', timeout: 120_000 },
  ],
});
