import { defineConfig } from '@playwright/test';
import config from './playwright.pdf-continuous.config';

export default defineConfig(config, {
  testMatch: 'question-dialog.pw.ts',
  outputDir: '../../../.codex-tmp/question-dialog',
});
