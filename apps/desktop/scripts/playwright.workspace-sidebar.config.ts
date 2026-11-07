import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e',
  testMatch: ['workspace-start.pw.ts', 'workspace-drawer.pw.ts', 'workspace-drawer-close.pw.ts',
    'workspace-drawer-overflow.pw.ts', 'workspace-project-switch.pw.ts', 'workspace-tab-menu.pw.ts',
    'file-preview.pw.ts', 'terminal.pw.ts', 'ssh-project-browser.pw.ts'],
  workers: 1, timeout: 60_000, reporter: 'list',
  outputDir: '../../../.codex-tmp/workspace-sidebar-playwright',
  use: { baseURL: 'http://127.0.0.1:1593', headless: true, locale: 'zh-CN',
    launchOptions: testBrowserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { cwd: '..',
    command: 'npx vite --config scripts/vite.workspace-sidebar.config.ts --host 127.0.0.1 --port 1593 --strictPort',
    url: 'http://127.0.0.1:1593', reuseExistingServer: false, timeout: 120_000 },
});
