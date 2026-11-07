import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'pdf-cmap.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/pdf-preview-desktop', reporter: 'list',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1517',
    viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.project-explorer.config.ts --host 127.0.0.1 --port 1517 --strictPort',
    url: 'http://127.0.0.1:1517' },
});
