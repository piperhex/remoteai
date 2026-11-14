import { defineConfig } from '@playwright/test';
import config from './playwright.pdf-continuous.config';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig(config, {
  testMatch: ['question-dialog.pw.ts', 'question-pager.pw.ts'],
  outputDir: '../../../.codex-tmp/question-dialog',
  timeout: 90_000,
  use: { ...config.use, baseURL: 'http://127.0.0.1:1583', permissions: ['microphone'],
    launchOptions: testBrowserLaunchOptions({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  }) },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.question-dialog.config.ts --host 127.0.0.1 --port 1583 --strictPort',
    url: 'http://127.0.0.1:1583', reuseExistingServer: false },
});
