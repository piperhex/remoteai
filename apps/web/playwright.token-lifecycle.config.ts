import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../scripts/test-browser.mjs';
process.env.CHAT_TEST_API_PORT = '1555';
export default defineConfig({
  testDir: './e2e', testMatch: 'token-route.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/token-lifecycle/web-route-results',
  use: { baseURL: 'http://127.0.0.1:1556/web/', headless: true, actionTimeout: 15000,
    launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node --loader ../web/e2e/token-fixture-loader.mjs e2e/mobile-fixture.mjs',
      cwd: '../desktop', url: 'http://127.0.0.1:1555/test/state',
      timeout: 180_000, env: { CHAT_TEST_API_PORT: '1555', CHAT_TEST_UI_PORT: '1557',
        CHAT_TEST_CACHE: '../../.codex-tmp/token-lifecycle/remote-host-cache' } },
    { command: 'npx vite --config e2e/token-route.vite.ts --host 127.0.0.1 --port 1556 --strictPort',
      url: 'http://127.0.0.1:1556/web/', timeout: 180_000, env: { VITE_DEV_API_URL: 'http://127.0.0.1:1555' } },
  ],
});
