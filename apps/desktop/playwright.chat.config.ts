import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/*.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../.codex-tmp/chat-playwright',
  use: { baseURL: 'http://127.0.0.1:1488', channel: process.env.CHAT_TEST_BROWSER ?? 'msedge',
    locale: 'zh-CN', headless: true },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1488', url: 'http://127.0.0.1:1488',
    reuseExistingServer: !process.env.CI },
});
