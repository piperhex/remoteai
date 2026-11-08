import { defineConfig } from '@playwright/test';
import chatConfig from './playwright.chat.config';

export default defineConfig({
  ...chatConfig,
  testMatch: ['image-preview-annotation.pw.ts', 'image-preview-toolbar.pw.ts', 'image-annotation.pw.ts'],
  outputDir: '../../../.codex-tmp/image-preview-annotation-playwright',
  use: { ...chatConfig.use, baseURL: 'http://127.0.0.1:1497' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1497 --strictPort',
    url: 'http://127.0.0.1:1497', reuseExistingServer: false },
});
