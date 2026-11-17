import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

export default defineConfig(base, {
  testMatch: 'directory-sync.pw.ts', timeout: 90_000,
  outputDir: '../../../.codex-tmp/directory-sync/playwright',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1578' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.cli-gui.config.ts --host 127.0.0.1 --port 1578',
    url: 'http://127.0.0.1:1578', reuseExistingServer: false },
});
