import { fileURLToPath } from 'node:url';
import { defineConfig, loadConfigFromFile, mergeConfig, normalizePath, type Plugin } from 'vite';

// This parent integration fixture uses Web's actual Vite host and the shared recovery UI.
// Keep it outside Web's generated standalone workspace and pinned dependency snapshots.
export default defineConfig(async environment => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const webConfig = fileURLToPath(new URL('../apps/web/scripts/vite.config.ts', import.meta.url));
  const loaded = await loadConfigFromFile(environment, webConfig);
  if (!loaded) throw new Error('Web Vite configuration is unavailable');
  const harness = normalizePath(fileURLToPath(new URL('../shared/testing/TaskRecoveryHarness.tsx', import.meta.url)));
  const fixture: Plugin = {
    name: 'task-recovery-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.split('?')[0].endsWith('/e2e/task-recovery-harness.html')) return next();
        try {
          const html = await server.transformIndexHtml(request.url,
            `<!doctype html><html><head><meta charset="UTF-8"></head><body>
              <div id="root"></div><script type="module" src="/@fs/${harness}"></script></body></html>`);
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
  };
  return mergeConfig(loaded.config, {
    server: { fs: { allow: [root] } },
    plugins: [fixture],
  });
});
