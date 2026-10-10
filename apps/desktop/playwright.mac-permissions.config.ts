import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/mac-permissions.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../.codex-tmp/mac-permissions-playwright',
  use: { baseURL: 'http://127.0.0.1:1496', channel: 'msedge', locale: 'zh-CN', headless: true },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1496 --strictPort',
    url: 'http://127.0.0.1:1496', reuseExistingServer: !process.env.CI },
});
