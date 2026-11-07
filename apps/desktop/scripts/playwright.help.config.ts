import { testBrowserChannel, testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';

const port = process.env.HELP_TEST_PORT ?? '1509';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '../e2e', testMatch: '**/help-*.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/help-playwright',
  use: {
    launchOptions: testBrowserLaunchOptions(),
    baseURL, channel: testBrowserChannel(process.env.CHAT_TEST_BROWSER),
    locale: 'zh-CN', headless: true, screenshot: 'only-on-failure' },
  projects: [
    { name: 'hosted' },
    { name: 'desktop', testMatch: '**/help-position.pw.ts' },
  ],
  webServer: { cwd: '..',
      command: `npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL, reuseExistingServer: !process.env.CI },
});
