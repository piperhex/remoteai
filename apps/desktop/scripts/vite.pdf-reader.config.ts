import { mergeConfig } from 'vite';
import config from './vite.website-tabs.config';

export default mergeConfig(config, { cacheDir: '../../.codex-tmp/pdf-continuous-vite' });
