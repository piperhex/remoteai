import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from './test-browser.mjs';

export default defineConfig({
  testDir: '.', testMatch: 'native-cli-web.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../.codex-tmp/native-cli-web-results',
  use: { baseURL: 'http://127.0.0.1:1499', locale: 'zh-CN', headless: true,
    launchOptions: testBrowserLaunchOptions() },
  webServer: { cwd: '../apps/desktop',
    command: 'npx vite --config scripts/vite.cli-gui.config.ts --host 127.0.0.1 --port 1499',
    url: 'http://127.0.0.1:1499', reuseExistingServer: false },
});
