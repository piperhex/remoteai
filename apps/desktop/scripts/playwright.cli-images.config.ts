import { defineConfig } from '@playwright/test';
import base from './playwright.cli-gui.config';

export default defineConfig({ ...base,
  testMatch: 'cli-images.pw.ts',
  outputDir: '../../../.codex-tmp/cli-images-playwright',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1499' },
  webServer: { cwd: '..', command: 'npx vite --config scripts/vite.cli-images.config.ts --host 127.0.0.1 --port 1499',
    url: 'http://127.0.0.1:1499', reuseExistingServer: Boolean(process.env.CLI_IMAGES_REUSE_SERVER) },
});
