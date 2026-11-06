import { defineConfig } from '@playwright/test';
import lounge from './playwright.lounge.config';

export default defineConfig({ ...lounge,
  testMatch: ['lounge-group-reads.pw.ts', 'group-read-observer.pw.ts', 'lounge-group-read-visibility.pw.ts'],
  outputDir: '../../.codex-tmp/lounge-group-read-results' });
