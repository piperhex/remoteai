import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/gui-update.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../.codex-tmp/gui-update-playwright', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1427/web/', channel: process.env.CHAT_TEST_BROWSER ?? 'msedge',
    locale: 'zh-CN', headless: true, launchOptions: { args: ['--disable-gpu'] },
    actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1427 --strictPort',
    url: 'http://127.0.0.1:1427/web/', timeout: 120_000 },
});
