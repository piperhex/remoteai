import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { imageEditorPlugin } from '../../shared/chat/imageEditorPlugin';
import { pdfAssetsPlugin } from '../../shared/file-preview/pdfAssetsPlugin';
export default defineConfig({
  plugins: [react(), imageEditorPlugin(), pdfAssetsPlugin()],
  build: { outDir: '../../.codex-tmp/image-ai-bundle', emptyOutDir: false,
    rollupOptions: { input: ['e2e/image-ai-harness.html', 'e2e/local-image-preview-harness.html',
      'e2e/image-viewer-drag-harness.html'] } },
});
