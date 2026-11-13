import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'running-conversations.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/running-conversations-results',
  use: { launchOptions: testBrowserLaunchOptions({ ignoreDefaultArgs: ['--hide-scrollbars'] }),
    baseURL: 'http://127.0.0.1:1599',
    headless: true, locale: 'zh-CN', trace: 'retain-on-failure' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.cli-gui.config.ts --host 127.0.0.1 --port 1599 --strictPort',
    url: 'http://127.0.0.1:1599', reuseExistingServer: false },
});
