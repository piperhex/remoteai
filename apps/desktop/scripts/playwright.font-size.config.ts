import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';

const desktopPort = process.env.FONT_TEST_DESKTOP_PORT ?? '1494';
const webPort = process.env.FONT_TEST_WEB_PORT ?? '1495';
const desktopUrl = `http://127.0.0.1:${desktopPort}`;
const webUrl = `http://127.0.0.1:${webPort}/web/`;

export default defineConfig({
  testDir: '../e2e', testMatch: 'font-size.pw.ts', workers: 1, timeout: 180_000,
  outputDir: '../../../.codex-tmp/font-size-playwright',
  use: {
    launchOptions: testBrowserLaunchOptions(),
    locale: 'zh-CN', headless: true, viewport: { width: 1280, height: 1000 } },
  projects: [
    { name: 'local', use: { baseURL: desktopUrl } },
    { name: 'remote', use: { baseURL: desktopUrl } },
    { name: 'web', use: { baseURL: webUrl } },
  ],
  webServer: [
    { cwd: '..',
      command: `npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port ${desktopPort} --strictPort`,
      url: `${desktopUrl}/e2e/font-size-harness.html`, reuseExistingServer: !process.env.CI },
    { cwd: '..',
      command: `npx vite --config ../web/scripts/vite.config.ts --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `${webUrl}e2e/font-size-harness.html`, reuseExistingServer: !process.env.CI },
  ],
});
