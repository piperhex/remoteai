import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'diff-cache.pw.ts', workers: 1, timeout: 180_000,
  outputDir: '../../../.codex-tmp/task6-playwright',
  reporter: [['list'], ['json', { outputFile: '../../.codex-tmp/task6-playwright.json' }]],
  use: { headless: true, launchOptions: testBrowserLaunchOptions(), locale: 'en-US',
    actionTimeout: 15_000, navigationTimeout: 120_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-local', use: { baseURL: 'http://127.0.0.1:1526', viewport: { width: 1280, height: 900 } } },
    { name: 'desktop-remote', use: { baseURL: 'http://127.0.0.1:1526', viewport: { width: 1280, height: 900 } } },
    { name: 'web-desktop', use: { baseURL: 'http://127.0.0.1:1527/web/', viewport: { width: 1280, height: 900 } } },
    { name: 'web-mobile', use: { baseURL: 'http://127.0.0.1:1527/web/',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { cwd: '..', command: 'npx vite --config e2e/diff-cache.vite.ts --port 1526',
      url: 'http://127.0.0.1:1526/diff-cache-harness.html', timeout: 120_000 },
    { cwd: '..', command: 'npx vite --config e2e/diff-cache.vite.ts --port 1527',
      env: { DIFF_CACHE_TEST_APP: 'web' }, url: 'http://127.0.0.1:1527/web/diff-cache-harness.html', timeout: 120_000 },
  ],
});
