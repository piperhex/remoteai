import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: '**/conversation-sync*.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/conversation-sync-desktop', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1489', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.conversation-sync.config.ts --host 127.0.0.1 --port 1489 --strictPort',
    url: 'http://127.0.0.1:1489', timeout: 120_000 },
});
