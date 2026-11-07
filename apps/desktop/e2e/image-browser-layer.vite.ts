import { mergeConfig } from 'vite';
import config from '../scripts/vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/image-browser-layer-vite',
  server: { watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
