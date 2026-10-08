import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/startup-update.pw.ts', workers: 1, timeout: 30_000,
  outputDir: '../../.codex-tmp/startup-update-playwright', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1428/web/', channel: process.env.CHAT_TEST_BROWSER ?? 'msedge',
    locale: 'zh-CN', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'narrow', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1428 --strictPort',
    url: 'http://127.0.0.1:1428/web/' },
});
