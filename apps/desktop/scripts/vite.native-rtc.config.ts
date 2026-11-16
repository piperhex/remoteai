import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/native-rtc-vite',
  server: { port: 18787, strictPort: true,
    watch: { ignored: ['**/src-tauri/target/**', '**/.codex-tmp/**'] } },
});
