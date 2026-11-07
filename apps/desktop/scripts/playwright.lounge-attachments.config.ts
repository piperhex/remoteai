import { defineConfig } from '@playwright/test';
import lounge from './playwright.lounge.config';

export default defineConfig({ ...lounge, testMatch: ['lounge-attachments.pw.ts', 'lounge-file-preview.pw.ts',
  'lounge-image-recovery.pw.ts'],
  webServer: [
    { cwd: '..', command: 'npx vite --config scripts/vite.lounge.config.ts --host 127.0.0.1 --port 1487 --strictPort',
      url: 'http://127.0.0.1:1487/e2e/lounge-harness.html', reuseExistingServer: !process.env.CI },
    { command: 'npx vite --config scripts/vite.config.ts --host 127.0.0.1 --port 1486 --strictPort', cwd: '../../web',
      url: 'http://127.0.0.1:1486/web/', reuseExistingServer: !process.env.CI },
  ],
  outputDir: '../../../.codex-tmp/lounge-files/playwright', timeout: 90_000 });
