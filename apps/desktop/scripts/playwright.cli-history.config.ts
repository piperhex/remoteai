import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

export default defineConfig(base, {
  testMatch: ['cli-history-race.pw.ts'], timeout: 120_000,
  outputDir: '../../../.codex-tmp/history-pagination/playwright',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1516' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.cli-history.config.ts --host 127.0.0.1 --port 1516',
    url: 'http://127.0.0.1:1516', reuseExistingServer: false, timeout: 120_000 },
});
