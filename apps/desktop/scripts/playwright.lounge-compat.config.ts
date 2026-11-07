import { defineConfig } from '@playwright/test';
import base from './playwright.lounge.config';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  ...base,
  testMatch: 'lounge-compat.pw.ts',
  use: { ...base.use, launchOptions: {} },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: testBrowserLaunchOptions() } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: {} } },
  ],
});
