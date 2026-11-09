import { mergeConfig } from 'vite';
import base from './vite.config';

// Keep native test fixtures and concurrent dependency exports from reloading browser scenarios.
export default mergeConfig(base, { server: { watch: null } });
