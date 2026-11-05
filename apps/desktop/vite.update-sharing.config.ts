import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfAssetsPlugin } from '../../shared/file-preview/pdfAssetsPlugin';

export default defineConfig({
  plugins: [react(), pdfAssetsPlugin()],
  cacheDir: '../../.codex-tmp/update-sharing-vite',
  optimizeDeps: { entries: ['e2e/update-sharing-harness.html'] },
  // Browser regressions run alongside Rust builds; their target trees must not drive HMR or discovery.
  server: { watch: null, hmr: false, strictPort: true },
});
