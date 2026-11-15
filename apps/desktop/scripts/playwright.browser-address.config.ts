import { defineConfig } from '@playwright/test';
import base from './playwright.browser-bookmarks.config';

export default defineConfig(base, {
  testMatch: 'browser-address.pw.ts',
  outputDir: '../../../.codex-tmp/browser-address-desktop',
});
