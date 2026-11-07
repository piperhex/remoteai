import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  cacheDir: '../../.codex-tmp/lounge-vite',
  optimizeDeps: { entries: ['./e2e/lounge-harness.html'] },
  server: { warmup: { clientFiles: ['./e2e/lounge-harness.tsx'] } },
}));
