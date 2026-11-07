import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  cacheDir: '../../.codex-tmp/provider-market-vite',
  server: { warmup: { clientFiles: ['./e2e/provider-market-harness.tsx'] } },
}));
