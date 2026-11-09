import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['terminal-tab-context-menu.pw.ts', 'terminal-tab-overflow.pw.ts'],
  workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/terminal-tab-menu-playwright',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1485',
    locale: 'zh-CN', headless: true },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1485',
    url: 'http://127.0.0.1:1485', reuseExistingServer: !process.env.CI },
});
