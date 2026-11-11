import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'task-recovery.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/task-recovery-playwright',
  use: { headless: true, launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: [
    { cwd: '..', command: 'npx vite --config scripts/vite.config.ts --port 1462 --strictPort',
      url: 'http://127.0.0.1:1462/e2e/task-recovery-harness.html', timeout: 90_000 },
    { cwd: '../../..', command: 'npx vite --config scripts/vite.task-recovery-web.config.ts --port 1463 --strictPort',
      url: 'http://127.0.0.1:1463/web/e2e/task-recovery-harness.html', timeout: 90_000 },
  ],
});
