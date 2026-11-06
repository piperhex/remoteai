import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fontSizePlugin } from '../../../shared/appearance/fontSizePlugin';
import { pdfAssetsPlugin } from '../../../shared/file-preview/pdfAssetsPlugin';

const web = process.env.CHANGES_SELECTION_APP === 'web';
export default defineConfig({
  root: resolve(web ? '../web/e2e' : 'e2e'), base: web ? '/web/' : '/',
  plugins: [react(), pdfAssetsPlugin()], css: { postcss: { plugins: [fontSizePlugin()] } },
  resolve: { dedupe: ['react', 'react-dom', 'antd', '@ant-design/cssinjs', '@remoteai/i18n'] },
  cacheDir: resolve(`../../.codex-tmp/changes-selection-vite-${web ? 'web' : 'desktop'}`),
  optimizeDeps: { entries: ['changes-selection-harness.html'] },
  server: { host: '127.0.0.1', strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**', '**/.worktrees/**'] } },
});
