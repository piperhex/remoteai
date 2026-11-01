import { defineConfig } from '@playwright/test';
import chatConfig from './playwright.chat.config';

const port = process.env.CHAT_TEST_WEB_PORT ?? '15581';
const baseURL = `http://127.0.0.1:${port}/web/`;

// These production-component fixtures need no desktop host or backend session.
export default defineConfig({
  ...chatConfig,
  testMatch: '**/chat-setting-segments.pw.ts',
  outputDir: '../../.codex-tmp/chat-settings-card-web',
  reporter: [['list']],
  use: { ...chatConfig.use, baseURL },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL,
    timeout: 120_000,
  },
});
