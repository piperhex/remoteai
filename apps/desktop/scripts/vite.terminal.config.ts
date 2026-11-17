import { defineConfig, mergeConfig } from 'vite';
import desktop from './vite.config';

export default mergeConfig(desktop, defineConfig({
  // Separate test servers must not replace one another's optimized dependencies.
  cacheDir: '../../.codex-tmp/terminal-vite-cache',
  optimizeDeps: { entries: ['e2e/terminal-harness.html'] },
}));
