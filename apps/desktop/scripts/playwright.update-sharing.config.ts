import { defineConfig } from '@playwright/test';
import base from './playwright.chat.config';

const url = 'http://127.0.0.1:1491';
const command = 'node ../../node_modules/vite/bin/vite.js --config scripts/vite.update-sharing.config.ts';
export default defineConfig({
  ...base,
  testMatch: '**/update-sharing.pw.ts',
  outputDir: '../../../.codex-tmp/update-sharing-playwright',
  use: { ...base.use, baseURL: url },
  webServer: { cwd: '..', command: `${command} --host 127.0.0.1 --port 1491`,
    url, reuseExistingServer: !process.env.CI },
});
