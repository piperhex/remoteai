import { defineConfig, mergeConfig } from 'vite';
import desktop from './vite.config';

export default mergeConfig(desktop, defineConfig({
  cacheDir: '../../.codex-tmp/website-links-vite-cache',
  optimizeDeps: { entries: ['e2e/website-tabs-harness.html'] },
}));
