import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', workers: 1, timeout: 90_000,
  testMatch: ['conversation-display.pw.ts', 'remote-gui.pw.ts'],
  grep: /completed rich replies|stopping preserves|remote GUI switches to Japanese/,
  outputDir: '../../../.codex-tmp/task1-rendering/desktop-parity',
  use: { baseURL: 'http://127.0.0.1:1545', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions() },
  webServer: { cwd: '..',
      command: 'npx vite --config e2e/stream-rendering.vite.ts --host 127.0.0.1 --port 1545 --strictPort',
    url: 'http://127.0.0.1:1545', timeout: 180_000, reuseExistingServer: false },
});
