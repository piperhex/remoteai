import { testBrowserChannel, testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';
import { defineConfig } from '@playwright/test';

const fixturePort = process.env.CHAT_TEST_API_PORT ?? '1490';
const fixtureUrl = process.env.CHAT_TEST_FIXTURE_URL ?? `http://127.0.0.1:${fixturePort}`;
const webPort = process.env.CHAT_TEST_WEB_PORT ?? '1422';
const webUrl = `http://127.0.0.1:${webPort}/web/`;

export default defineConfig({
  testDir: './e2e', testMatch: ['**/chat.pw.ts', '**/queue.pw.ts', '**/chat-parity.pw.ts',
    '**/chat-swipe.pw.ts', '**/chat-display.pw.ts', '**/thread-pagination.pw.ts', '**/project-collapse.pw.ts',
    '**/skill-menu.pw.ts', '**/i18n-chat.pw.ts', '**/chat-history-scroll.pw.ts', '**/chat-history-touch.pw.ts',
    '**/chat-scroll-bottom.pw.ts',
    '**/image-editor.pw.ts',
    '**/file-preview.pw.ts', '**/chat-devices.pw.ts', '**/image-editor-csp.pw.ts', '**/chat-diff.pw.ts',
    '**/chat-terminal.pw.ts', '**/chat-terminal-display.pw.ts', '**/chat-activities.pw.ts', '**/downloads.pw.ts',
    '**/thread-actions.pw.ts', '**/project-menus.pw.ts', '**/chat-markdown.pw.ts', '**/chat-git.pw.ts', '**/task-review.pw.ts',
    '**/connection-health.pw.ts', '**/connection-info.pw.ts', '**/text-selection.pw.ts', '**/download-actions.pw.ts',
    '**/download-sharing.pw.ts',
    '**/preview-downloads.pw.ts', '**/chat-steering.pw.ts', '**/tablet-layout.pw.ts', '**/chat-accounts.pw.ts',
    '**/tool-details.pw.ts', '**/virtual-command-output.pw.ts',
    '**/chat-sidebar-resize.pw.ts', '**/chat-setting-segments.pw.ts'],
  workers: 1, timeout: 150_000,
  outputDir: '../../.codex-tmp/h5-chat-playwright',
  reporter: [['list'], ['html', { outputFolder: '../../.codex-tmp/h5-chat-report', open: 'never' }]],
  use: {
    launchOptions: testBrowserLaunchOptions(),
    baseURL: webUrl, channel: testBrowserChannel(process.env.CHAT_TEST_BROWSER),
    locale: 'zh-CN', headless: true, actionTimeout: 15_000, navigationTimeout: 20_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: [
    { command: 'node e2e/mobile-fixture.mjs', cwd: '../desktop', url: `${fixtureUrl}/test/state`,
      timeout: 120_000, reuseExistingServer: process.env.CHAT_TEST_REUSE_FIXTURE === '1' },
    { command: `npx vite --host 127.0.0.1 --port ${webPort} --strictPort`, url: webUrl,
      reuseExistingServer: process.env.CHAT_TEST_REUSE_FIXTURE === '1',
      env: { VITE_DEV_API_URL: fixtureUrl } },
  ],
});
