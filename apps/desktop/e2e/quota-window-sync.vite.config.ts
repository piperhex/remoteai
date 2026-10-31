import { defineConfig, mergeConfig } from 'vite';
import desktop from '../vite.config';

// Native builds lock executable files on Windows; this UI fixture only watches frontend source.
export default mergeConfig(desktop, defineConfig({
  server: { watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**'] } },
}));
