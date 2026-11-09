import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'ssh-mentions.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/ssh-mentions-playwright',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1542',
    locale: 'zh-CN', headless: true },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1542 --strictPort',
    url: 'http://127.0.0.1:1542/e2e/ssh-mentions-harness.html', reuseExistingServer: !process.env.CI },
});
