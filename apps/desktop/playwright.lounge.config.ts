import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: './e2e', testMatch: ['lounge-mobile-gestures.pw.ts', 'lounge-group-send.pw.ts', 'lounge.pw.ts', 'lounge-replies.pw.ts',
    'lounge-direct.pw.ts', 'lounge-receipts.pw.ts', 'lounge-group-reads.pw.ts', 'lounge-admin-badge.pw.ts',
    'lounge-mobile-redesign.pw.ts', 'lounge-mobile-scroll.pw.ts', 'lounge-history-timeline.pw.ts',
    'lounge-desktop-history.pw.ts', 'lounge-client-version.pw.ts', 'lounge-device-presence.pw.ts',
    'lounge-opening-limit.pw.ts', 'lounge-avatars.pw.ts', 'lounge-avatar-cache.pw.ts',
    'settings-avatars.pw.ts', 'lounge-images.pw.ts',
    'lounge-emoji.pw.ts', 'lounge-text.pw.ts', 'lounge-presence.pw.ts', 'lounge-profile.pw.ts',
    'lounge-navigation.pw.ts', 'lounge-new-chat.pw.ts', 'lounge-new-chat-mobile.pw.ts', 'lounge-ordering.pw.ts',
    'lounge-chat-actions.pw.ts', 'lounge-names.pw.ts', 'lounge-my-account.pw.ts',
    'lounge-context-menus.pw.ts', 'lounge-contact-sync.pw.ts', 'lounge-image-annotation.pw.ts'],
  workers: 1, timeout: 60_000,
  outputDir: '../../.codex-tmp/lounge-playwright',
  use: { baseURL: 'http://127.0.0.1:1487', launchOptions: testBrowserLaunchOptions(),
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npx vite --host 127.0.0.1 --port 1487 --strictPort', url: 'http://127.0.0.1:1487',
      reuseExistingServer: !process.env.CI },
    { command: 'npx vite --host 127.0.0.1 --port 1486 --strictPort', cwd: '../web',
      url: 'http://127.0.0.1:1486/web/', reuseExistingServer: !process.env.CI },
  ],
});
