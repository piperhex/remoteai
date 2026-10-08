import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-language', testMatch: '**/*.pw.ts', workers: 1, timeout: 45_000,
  outputDir: '../../.codex-tmp/language-playwright', reporter: 'list',
  use: { channel: process.env.CHAT_TEST_BROWSER ?? 'msedge', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // Build desktop and web first; check the same frontend assets that ship to users.
  webServer: [
    { command: 'node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1486 --strictPort',
      url: 'http://127.0.0.1:1486' },
    { command: 'node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1487 --strictPort', cwd: '../web',
      url: 'http://127.0.0.1:1487/web/' },
  ],
});
