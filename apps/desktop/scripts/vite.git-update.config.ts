import { mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, {
  cacheDir: '../../.codex-tmp/git-update-vite',
  optimizeDeps: { entries: ['e2e/git-update.html'] },
});
