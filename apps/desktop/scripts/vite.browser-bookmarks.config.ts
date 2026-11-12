import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/browser-bookmarks-vite',
  optimizeDeps: { entries: ['e2e/browser-bookmarks-harness.html'] },
  server: { watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
