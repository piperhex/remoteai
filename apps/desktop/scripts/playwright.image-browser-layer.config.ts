import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'image-browser-layer.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../../.codex-tmp/image-browser-layer',
  use: { baseURL: 'http://127.0.0.1:1567', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: { cwd: '..',
      command: 'npx vite --config e2e/image-browser-layer.vite.ts --host 127.0.0.1 --port 1567 --strictPort',
    url: 'http://127.0.0.1:1567', reuseExistingServer: true },
});
