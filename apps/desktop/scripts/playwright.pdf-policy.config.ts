import { defineConfig } from '@playwright/test';
import config from './playwright.pdf-continuous.config';

export default defineConfig(config, {
  testMatch: 'pdf-policy.pw.ts', outputDir: '../../../.codex-tmp/pdf-policy',
});
