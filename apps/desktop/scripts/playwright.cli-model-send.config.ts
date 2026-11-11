import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

export default defineConfig(base, {
  testMatch: 'cli-model-send.pw.ts', timeout: 90_000,
  outputDir: '../../../.codex-tmp/cli-model-send/playwright',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1507', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.cli-model-send.config.ts --host 127.0.0.1 --port 1507',
    url: 'http://127.0.0.1:1507', reuseExistingServer: false, timeout: 120_000 },
});
