import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

const port = 1508;
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  ...base,
  testMatch: ['**/request-error-timeline.pw.ts', '**/request-error.pw.ts', '**/capacity-error.pw.ts'],
  outputDir: '../../../.codex-tmp/error-timeline-desktop',
  reporter: 'list',
  use: { ...base.use, baseURL: url },
  webServer: { cwd: '..',
    command: `npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url },
});
