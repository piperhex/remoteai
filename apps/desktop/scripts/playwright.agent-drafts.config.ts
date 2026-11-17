import { defineConfig } from '@playwright/test';
import chat from './playwright.chat.config';

export default defineConfig({
  ...chat,
  testMatch: '**/agent-drafts.pw.ts',
  outputDir: '../../../.codex-tmp/agent-drafts-playwright',
  use: { ...chat.use, baseURL: 'http://127.0.0.1:1498' },
  webServer: {
    cwd: '..',
    command: 'npx vite --config scripts/vite.agent-drafts.config.ts --host 127.0.0.1 --port 1498 --strictPort',
    url: 'http://127.0.0.1:1498', reuseExistingServer: false,
  },
});
