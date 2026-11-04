import { defineConfig } from '@playwright/test';
import explorer from './playwright.project-explorer.config';

export default defineConfig({
  ...explorer,
  outputDir: '../../.codex-tmp/project-picker-tests',
  use: { ...explorer.use, baseURL: 'http://127.0.0.1:1517' },
  webServer: {
    command: 'npx vite --config vite.project-explorer.config.ts --host 127.0.0.1 --port 1517',
    url: 'http://127.0.0.1:1517/e2e/project-picker-harness.html', reuseExistingServer: false,
  },
});
