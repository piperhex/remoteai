import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'json-preview.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/json-preview-playwright',
  use: { launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN', headless: true,
    viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', grep: /local:|remote:|10 MB/, use: { baseURL: 'http://127.0.0.1:1488' } },
    { name: 'web', grep: /web:|legacy:/, use: { baseURL: 'http://127.0.0.1:1499/web/' } },
  ],
  webServer: [
    { cwd: '..',
      command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1488 --strictPort',
      url: 'http://127.0.0.1:1488',
      reuseExistingServer: !process.env.CI },
    { command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1499 --strictPort', cwd: '../../web',
      url: 'http://127.0.0.1:1499/web/', reuseExistingServer: !process.env.CI },
  ],
});
