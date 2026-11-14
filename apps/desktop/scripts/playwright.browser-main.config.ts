import { defineConfig } from '@playwright/test';
import base from './playwright.browser-bookmarks.config';

export default defineConfig(base, {
  testMatch: ['browser-main.pw.ts', 'browser-settings-submenus.pw.ts'],
  outputDir: '../../../.codex-tmp/browser-submenus-desktop',
});
