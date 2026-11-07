import { mergeConfig } from 'vite';
import desktop from '../scripts/vite.config';

export default mergeConfig(desktop, {
  cacheDir: '../../.codex-tmp/task1-rendering/vite-cache',
  optimizeDeps: { entries: ['e2e/tool-history-harness.html', 'e2e/remote-gui-harness.html', 'e2e/chat-harness.html'] },
  // Freeze regression fixtures and avoid watching native build artifacts in the shared workspace.
  server: { watch: { ignored: ['**/*'] }, hmr: false },
});
