import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['website-tabs.pw.ts', 'reply-resources.pw.ts', 'reply-image-menu.pw.ts',
    'browser-loading.pw.ts', 'workspace-start.pw.ts', 'workspace-tab-menu.pw.ts'],
  workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/website-tabs',
  use: { baseURL: 'http://127.0.0.1:1552', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN' },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.website-tabs.config.ts --host 127.0.0.1 --port 1552 --strictPort',
    url: 'http://127.0.0.1:1552', reuseExistingServer: true },
});
