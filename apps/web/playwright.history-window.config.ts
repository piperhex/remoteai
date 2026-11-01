import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: ['chat-history-window.pw.ts', 'chat-history-touch.pw.ts',
    'chat-history-scroll.pw.ts', 'chat-scroll-bottom.pw.ts', 'chat-display.pw.ts', 'chat-rendering.pw.ts'],
  workers: 1, timeout: 120_000,
  outputDir: '../../.codex-tmp/history-window-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1432/web/', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1432 --strictPort',
    url: 'http://127.0.0.1:1432/web/', reuseExistingServer: true },
});
