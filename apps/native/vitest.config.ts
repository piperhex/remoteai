import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({ test: { setupFiles: ['../../shared/i18n/testLocale.ts'] }, resolve: { alias: {
  // Shared hooks must use the same React instance as the native renderer and its test mocks.
  react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
} } });
