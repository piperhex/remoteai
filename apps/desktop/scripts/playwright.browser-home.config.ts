import { defineConfig } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

export default defineConfig({
  testDir: '../e2e', testMatch: 'browser-home.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../../.codex-tmp/browser-home-evidence',
  use: { baseURL: 'http://127.0.0.1:1578', launchOptions: testBrowserLaunchOptions(), locale: 'zh-CN' },
  webServer: [
    { cwd: '../src-tauri', command: 'cargo test --test codex_switch_lib_tests browser_home::ui_fixture::serve_native_home_ui -- --ignored --nocapture',
      env: { BROWSER_HOME_UI_FIXTURE: '1', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0' },
      url: 'http://127.0.0.1:1593/cached', timeout: 240_000, reuseExistingServer: true },
    { cwd: '../../admin', command: 'go run ./scripts/browser-home-fixture',
      url: 'http://127.0.0.1:1591/browser-home/current', timeout: 120_000, reuseExistingServer: true },
    { cwd: '..', command: 'npx vite --config scripts/vite.browser-bookmarks.config.ts --host 127.0.0.1 --port 1578 --strictPort',
      url: 'http://127.0.0.1:1578', reuseExistingServer: true, timeout: 120_000 },
    { cwd: '../../admin-ui', command: 'npx vite --config scripts/vite.browser-home.config.ts --port 1592 --strictPort',
      url: 'http://127.0.0.1:1592/admin.html', reuseExistingServer: true, timeout: 120_000 },
    { cwd: '../../web', command: 'npx vite --config scripts/vite.config.ts --port 1579 --strictPort',
      url: 'http://127.0.0.1:1579/web/', reuseExistingServer: true, timeout: 120_000 },
  ],
});
