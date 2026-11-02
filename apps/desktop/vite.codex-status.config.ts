import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/codex-status-vite',
  server: { watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**'] } },
});
