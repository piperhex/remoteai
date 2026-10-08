import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/desktop-update.pw.ts', workers: 1,
  outputDir: '../../.codex-tmp/desktop-update-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1427/web/', channel: 'chrome', locale: 'zh-CN', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: [
    { command: 'node e2e/desktop-update-fixture.mjs', url: 'http://127.0.0.1:1459', reuseExistingServer: true },
    { command: 'npx vite --host 127.0.0.1 --port 1427 --strictPort',
      url: 'http://127.0.0.1:1427/web/', reuseExistingServer: true },
  ],
});
