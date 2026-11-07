import { mergeConfig } from 'vite';
import desktop from './vite.config';

// Keep fixture startup independent of other dev servers and native build output.
export default mergeConfig(desktop, {
  cacheDir: '../../.codex-tmp/project-explorer-vite',
  server: { watch: { ignored: ['**/.codex-tmp/**', '**/src-tauri/target/**', '**/dist/**'] } },
});
