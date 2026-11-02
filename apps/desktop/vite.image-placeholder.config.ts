import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/image-placeholders/vite-cache',
  optimizeDeps: { entries: ['e2e/image-history-harness.html', 'e2e/tool-history-harness.html'] },
  server: { watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
