import { defineConfig } from '@playwright/test';
import lounge from './playwright.lounge.config';

export default defineConfig({ ...lounge, testMatch: ['lounge-group-reads.pw.ts'],
  outputDir: '../../.codex-tmp/lounge-group-read-results' });
