import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  cacheDir: '../../.codex-tmp/history-pagination/vite-cache',
  optimizeDeps: { entries: ['e2e/cli-gui-harness.html'] },
}));
