import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './vite.config';

// Keep fixture dependency optimization separate from concurrently running application previews.
export default mergeConfig(base, defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.codex-tmp/computer-use-admin-vite', import.meta.url)),
}));
