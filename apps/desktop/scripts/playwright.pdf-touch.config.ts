import { defineConfig } from '@playwright/test';
import config from './playwright.pdf-continuous.config';

export default defineConfig(config, { testMatch: 'pdf-touch.pw.ts', outputDir: '../../../.codex-tmp/pdf-touch',
  use: { viewport: { width: 412, height: 850 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
