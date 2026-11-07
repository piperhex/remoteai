import { mergeConfig } from 'vite';
import config from './vite.config';

export default mergeConfig(config, {
  cacheDir: '../../.codex-tmp/workspace-sidebar-vite',
  server: { watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**', '**/.worktrees/**'] } },
});
