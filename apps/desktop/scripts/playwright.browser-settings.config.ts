import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.browser-bookmarks.config';

export default defineConfig(browserConfig, {
  testMatch: 'browser-settings.pw.ts',
  outputDir: '../../../.codex-tmp/browser-settings-evidence',
});
