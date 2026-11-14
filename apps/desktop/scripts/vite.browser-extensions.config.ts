import { mergeConfig } from 'vite';
import config from './vite.config';
export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/browser-extensions-vite',
  optimizeDeps: { entries: ['e2e/browser-extensions-harness.html'] },
  server: { watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**'] },
    proxy: { '/browser-extensions': 'http://127.0.0.1:1592' } },
});
