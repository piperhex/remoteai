import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: ['project-explorer*.pw.ts', 'project-picker.pw.ts', 'compact-project.pw.ts'],
  workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/project-explorer-tests',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1494',
    locale: 'zh-CN', headless: true },
  webServer: { command: 'npx vite --config vite.project-explorer.config.ts --host 127.0.0.1 --port 1494',
    url: 'http://127.0.0.1:1494',
    reuseExistingServer: !process.env.CI },
});
