import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/file-preview-vite',
  server: { watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
