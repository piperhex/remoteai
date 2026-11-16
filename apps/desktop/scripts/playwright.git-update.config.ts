import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['git-update.pw.ts'], workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/git-update-desktop',
  use: { baseURL: 'http://127.0.0.1:1584', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.git-update.config.ts --host 127.0.0.1 --port 1584',
    url: 'http://127.0.0.1:1584', reuseExistingServer: false },
});
