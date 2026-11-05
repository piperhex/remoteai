import { defineConfig } from 'vite';
import { pdfAssetsPlugin } from '../../../shared/file-preview/pdfAssetsPlugin';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fontSizePlugin } from '../../../shared/appearance/fontSizePlugin';

const web = process.env.DIFF_CACHE_TEST_APP === 'web';
export default defineConfig({
  root: resolve(web ? '../web/e2e' : 'e2e'), base: web ? '/web/' : '/',
  plugins: [react(), pdfAssetsPlugin()], css: { postcss: { plugins: [fontSizePlugin()] } },
  cacheDir: resolve(`../../.codex-tmp/task6-vite-${web ? 'web' : 'desktop'}`),
  // Isolate this fixture from the hundreds of other HTML test entry points and concurrent Vite caches.
  optimizeDeps: { entries: ['diff-cache-harness.html'] },
  server: { host: '127.0.0.1', strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**', '**/.worktrees/**'] } },
});
