import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'codex-status.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/codex-status',
  use: { baseURL: 'http://127.0.0.1:1563', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN',
    viewport: { width: 1440, height: 900 } },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.codex-status.config.ts --host 127.0.0.1 --port 1563 --strictPort',
    url: 'http://127.0.0.1:1563', reuseExistingServer: true },
});
