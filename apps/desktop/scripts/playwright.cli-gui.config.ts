import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

export default defineConfig(base, {
  testMatch: ['cli-*.pw.ts', 'codex-install-progress.pw.ts'], timeout: 90_000,
  outputDir: '../../../.codex-tmp/cli-gui-playwright',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1496' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.cli-gui.config.ts --host 127.0.0.1 --port 1496',
    url: 'http://127.0.0.1:1496', reuseExistingServer: false },
});
