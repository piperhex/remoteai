import { testBrowserChannel, testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: 'keyboard-shortcuts.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/shortcuts-playwright',
  use: {
    launchOptions: testBrowserLaunchOptions(),
    baseURL: 'http://127.0.0.1:1493', channel: testBrowserChannel(process.env.CHAT_TEST_BROWSER),
    locale: 'zh-CN', headless: true },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1493',
      url: 'http://127.0.0.1:1493',
    reuseExistingServer: false },
});
