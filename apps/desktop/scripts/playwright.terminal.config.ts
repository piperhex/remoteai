import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const port = 1496;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '../e2e', testMatch: ['terminal.pw.ts', 'terminal-clipboard.pw.ts'], workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/terminal-destinations-desktop',
  use: { baseURL, launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN', headless: true },
  webServer: { cwd: '..',
    command: `npx vite --config scripts/vite.terminal.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL, timeout: 120_000, reuseExistingServer: false },
});
