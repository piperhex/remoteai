import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'official-accounts.pw.ts', workers: 1, timeout: 120_000,
  outputDir: '../../../.codex-tmp/official-accounts', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1498', launchOptions: testBrowserLaunchOptions(),
    locale: 'zh-CN', viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.official-accounts.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:1498', reuseExistingServer: false },
});
