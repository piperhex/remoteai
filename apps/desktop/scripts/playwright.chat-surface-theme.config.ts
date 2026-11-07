import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'chat-surface-theme.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/chat-surface-theme-desktop',
  use: { baseURL: 'http://127.0.0.1:1497', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1280, height: 1000 }, locale: 'zh-CN', screenshot: 'only-on-failure' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1497 --strictPort',
    url: 'http://127.0.0.1:1497', timeout: 120_000 },
});
