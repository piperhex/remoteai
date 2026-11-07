import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  cacheDir: '../../.codex-tmp/project-editor/vite-cache',
}));
