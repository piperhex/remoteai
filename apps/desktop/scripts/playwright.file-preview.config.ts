import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['browser-file-preview.pw.ts', 'browser-preview-gestures.pw.ts',
    'project-browser.pw.ts', 'ssh-project-browser.pw.ts'],
  workers: 1, timeout: 45_000, outputDir: '../../../.codex-tmp/file-preview-playwright',
  use: { baseURL: 'http://127.0.0.1:1546', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions() },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.file-preview.config.ts --host 127.0.0.1 --port 1546 --strictPort',
    url: 'http://127.0.0.1:1546', reuseExistingServer: false, timeout: 120_000 },
});
