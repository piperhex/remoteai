import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e',
  testMatch: ['image-placeholder.pw.ts', 'image-history.pw.ts', 'message-images.pw.ts', 'image-navigation.pw.ts'],
  workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/image-placeholders/playwright',
  use: { baseURL: 'http://127.0.0.1:1573', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions() },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.image-placeholder.config.ts --host 127.0.0.1 --port 1573 --strictPort',
    url: 'http://127.0.0.1:1573', reuseExistingServer: false },
});
