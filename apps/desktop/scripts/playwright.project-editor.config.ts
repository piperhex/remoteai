import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: ['project-editor-window.pw.ts', 'project-browser-large-text.pw.ts'],
  workers: 1, timeout: 180_000,
  outputDir: '../../../.codex-tmp/project-editor/screenshots',
  use: { launchOptions: testBrowserLaunchOptions(), baseURL: 'http://127.0.0.1:1496', headless: true, locale: 'zh-CN' },
  webServer: { cwd: '..',
      command: 'npx vite --config scripts/vite.project-editor.config.ts --host 127.0.0.1 --port 1496',
    url: 'http://127.0.0.1:1496', reuseExistingServer: true },
});
