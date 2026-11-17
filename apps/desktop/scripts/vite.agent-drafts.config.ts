import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  cacheDir: '../../../.codex-tmp/agent-drafts-vite',
  optimizeDeps: { entries: ['e2e/agent-drafts-harness.html'] },
  server: { watch: { ignored: ['**/src-tauri/**', '**/target/**'] } },
}));
