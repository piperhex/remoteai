import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e',
  testMatch: /(?:image-ai|local-image-preview|image-preview-toolbar|image-viewer-(?:drag|zoom|dismiss))\.pw\.ts/,
  workers: 1, timeout: 30_000,
  outputDir: '../../../.codex-tmp/image-ai-playwright',
  use: {
    launchOptions: testBrowserLaunchOptions(),
    baseURL: 'http://127.0.0.1:1495', locale: 'zh-CN', headless: true },
  webServer: { cwd: '..', command: 'npx vite build --config scripts/vite.image-ai.config.ts'
    + ' && npx vite preview --config scripts/vite.image-ai.config.ts --host 127.0.0.1 --port 1495',
    url: 'http://127.0.0.1:1495/e2e/image-ai-harness.html',
    reuseExistingServer: !process.env.CI },
});
