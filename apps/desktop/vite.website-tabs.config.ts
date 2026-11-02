import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/website-tabs-vite',
  server: { watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
