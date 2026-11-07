import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const output = process.env.MERMAID_BASELINE === '1' ? 'mermaid-task7-baseline' : 'mermaid-task7';
export default defineConfig({
  testDir: '../e2e', testMatch: '**/mermaid*.pw.ts', workers: 1, timeout: 60_000,
  outputDir: `../../.codex-tmp/${output}`,
  reporter: [['list'], ['json', { outputFile: `../../.codex-tmp/${output}-results.json` }]],
  use: { baseURL: 'http://127.0.0.1:1496', headless: true, locale: 'zh-CN',
    viewport: { width: 1100, height: 800 }, launchOptions: testBrowserLaunchOptions() },
  webServer: { cwd: '..', command: 'node ../../node_modules/vite/bin/vite.js --config e2e/mermaid-vite.config.ts '
      + '--host 127.0.0.1 --port 1496 --strictPort',
    url: 'http://127.0.0.1:1496' },
});
