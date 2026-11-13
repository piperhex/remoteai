import { defineConfig } from '@playwright/test';
import base from './playwright.command-details-navigation.config';

export default defineConfig({ ...base, testMatch: 'tool-windows-navigation.pw.ts', timeout: 120_000,
  outputDir: '../../../.codex-tmp/tool-windows-playwright' });
