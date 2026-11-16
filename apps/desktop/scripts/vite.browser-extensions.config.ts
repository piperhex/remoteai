import { mergeConfig, type ViteDevServer } from 'vite';
import config from './vite.config';
import tauriConfig from '../src-tauri/tauri.conf.json';
export default mergeConfig(config, {
  plugins: [{ name: 'extension-market-packaged-network-policy', configureServer(server: ViteDevServer) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.includes('marketPolicy=1')) {
        response.setHeader('Content-Security-Policy', `connect-src ${tauriConfig.app.security.csp['connect-src']}`);
      }
      next();
    });
  } }],
  cacheDir: '../../.codex-tmp/browser-extensions-vite',
  optimizeDeps: { entries: ['e2e/browser-extensions-harness.html'] },
  server: { watch: { ignored: ['**/src-tauri/**', '**/.codex-tmp/**'] },
    proxy: { '/browser-extensions': 'http://127.0.0.1:1592' } },
});
