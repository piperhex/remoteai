import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { basePath, siteUrl } from './site.config.mjs';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  base: basePath,
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  server: { port: 4175, strictPort: true },
  preview: { port: 4175, strictPort: true },
  build: {
    // Only the client build copies the optimized public assets.
    copyPublicDir: !isSsrBuild,
    rollupOptions: {
      output: { entryFileNames: isSsrBuild ? 'entry-server.js' : 'assets/[name]-[hash].js' },
    },
  },
}));
