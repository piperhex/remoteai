import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: ['**/management.pw.ts', '**/i18n.pw.ts', '**/agreement.pw.ts', '**/theme.pw.ts'],
  workers: 1, timeout: 45_000,
  outputDir: '../../.codex-tmp/web-management-playwright',
  reporter: [['list'], ['html', { outputFolder: '../../.codex-tmp/web-management-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:1423/web/', channel: process.env.CHAT_TEST_BROWSER ?? 'msedge',
    locale: 'zh-CN', headless: true, actionTimeout: 10_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'narrow', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    { command: 'node e2e/management-fixture.mjs', url: 'http://127.0.0.1:1491/auth/me',
      reuseExistingServer: process.env.MANAGEMENT_REUSE_SERVER === '1' },
    { command: 'npx vite --host 127.0.0.1 --port 1423 --strictPort', url: 'http://127.0.0.1:1423/web/',
      env: { VITE_DEV_API_URL: 'http://127.0.0.1:1491' }, reuseExistingServer: process.env.MANAGEMENT_REUSE_SERVER === '1' },
  ],
});
