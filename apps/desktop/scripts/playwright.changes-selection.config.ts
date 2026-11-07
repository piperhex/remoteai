import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'changes-selection.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/changes-selection-results', reporter: 'list',
  use: { headless: true, launchOptions: testBrowserLaunchOptions(), locale: 'en-US',
    actionTimeout: 15_000,
    viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-local', use: { baseURL: 'http://127.0.0.1:1586' } },
    { name: 'desktop-remote', use: { baseURL: 'http://127.0.0.1:1586' } },
    { name: 'web-desktop', use: { baseURL: 'http://127.0.0.1:1587/web/' } },
  ],
  webServer: [
    { cwd: '..', command: 'npx vite --config e2e/changes-selection.vite.ts --port 1586',
      url: 'http://127.0.0.1:1586/changes-selection-harness.html', timeout: 120_000 },
    { cwd: '..', command: 'npx vite --config e2e/changes-selection.vite.ts --port 1587',
      env: { CHANGES_SELECTION_APP: 'web' },
      url: 'http://127.0.0.1:1587/web/changes-selection-harness.html', timeout: 120_000 },
  ],
});
