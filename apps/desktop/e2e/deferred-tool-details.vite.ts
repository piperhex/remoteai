import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fontSizePlugin } from '../../../shared/appearance/fontSizePlugin';
import { pdfAssetsPlugin } from '../../../shared/file-preview/pdfAssetsPlugin';

const web = process.env.TOOL_DETAILS_TEST_APP === 'web';
export default defineConfig({
  root: resolve(web ? '../web/e2e' : 'e2e'), base: web ? '/web/' : '/',
  plugins: [react(), pdfAssetsPlugin()], css: { postcss: { plugins: [fontSizePlugin()] } },
  cacheDir: resolve(`../../.codex-tmp/deferred-tool-details-vite-${web ? 'web' : 'desktop'}`),
  optimizeDeps: { entries: ['deferred-tool-details-harness.html'] },
  resolve: { dedupe: ['react', 'react-dom', 'antd', '@remoteai/i18n'] },
  server: { host: '127.0.0.1', strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**', '**/.worktrees/**'] } },
});
