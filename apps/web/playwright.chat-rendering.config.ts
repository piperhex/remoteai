import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: 'chat-rendering.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/task1-rendering/playwright',
  use: { baseURL: 'http://127.0.0.1:1541/web/', headless: true,
    launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  projects: [
    { name: 'web-desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'web-mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1541 --strictPort',
    url: 'http://127.0.0.1:1541/web/', timeout: 120_000 },
});
