import { defineConfig } from '@playwright/test';
import config from './playwright.pdf-continuous.config';

export default defineConfig(config, {
  testMatch: 'pdf-preview-regressions.pw.ts',
  outputDir: '../../../.codex-tmp/pdf-preview-regressions',
});
