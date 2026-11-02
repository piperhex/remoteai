import { defineConfig } from '@playwright/test';
import base from './playwright.token-lifecycle.config';

export default defineConfig({
  ...base,
  testMatch: ['navigation-retention.pw.ts', 'token-route.pw.ts'],
  outputDir: '../../.codex-tmp/tab-retention/web',
  projects: [
    { name: 'desktop-wide', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'desktop-narrow', use: { viewport: { width: 900, height: 1000 } } },
  ],
});
