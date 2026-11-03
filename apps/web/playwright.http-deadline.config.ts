import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: '**/http-deadline.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/http-deadline-browser', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1473/web/', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions() },
  projects: [
    { name: 'web-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-web', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1473 --strictPort',
    url: 'http://127.0.0.1:1473/web/', reuseExistingServer: false, timeout: 90_000 },
});
