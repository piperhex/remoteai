import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { pdfAssetsPlugin } from '../../../../shared/file-preview/pdfAssetsPlugin';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), pdfAssetsPlugin()],
  build: { outDir: fileURLToPath(new URL('../../../../.codex-tmp/ssh-native-live/frontend', import.meta.url)),
    emptyOutDir: true, target: 'chrome105' },
});
