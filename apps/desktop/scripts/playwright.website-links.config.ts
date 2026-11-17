import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const port = 1497;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '../e2e', testMatch: 'website-links.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../../.codex-tmp/website-links-desktop',
  use: { baseURL, launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN', headless: true },
  webServer: { cwd: '..',
    command: `npx vite --config scripts/vite.website-links.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL, timeout: 120_000, reuseExistingServer: false },
});
