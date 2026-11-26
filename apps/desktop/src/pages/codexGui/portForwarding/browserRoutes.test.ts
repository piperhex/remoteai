import { expect, it, vi } from 'vitest';
import { BrowserRoutes, type BrowserRoute } from '../../../../../../shared/port-mapping/browserRoutes';

const tunnel = () => ({ resolve: vi.fn(), close: vi.fn(async () => {}) });

it('removes the old domain before releasing the listener and keeps independent mappings', async () => {
  const updates: BrowserRoute[][] = [];
  const index = new BrowserRoutes(async routes => { updates.push(routes); });
  const first = index.attach(tunnel(), 8000), second = index.attach(tunnel(), 8001);
  await first.setBrowserDomain?.('dev.test');
  await second.setBrowserDomain?.('dev.test');
  const changed = first.setBrowserDomain?.('second.test');
  await second.close(); await changed;
  expect(updates.at(-1)).toEqual([{ domain: 'second.test', port: 8000 }]);
  await first.setBrowserDomain?.('app.localhost');
  await first.close();
  await first.setBrowserDomain?.('late.test');
  expect(updates.at(-1)).toEqual([]);
  expect(updates).toHaveLength(5);
});

it('closes the tunnel if the browser has shut down and allows later registrations', async () => {
  const configure = vi.fn(async (_routes: BrowserRoute[]) => {});
  const routes = new BrowserRoutes(configure);
  const listener = tunnel();
  const mapping = routes.attach(listener, 8000);
  await mapping.setBrowserDomain?.('first.test');
  configure.mockRejectedValueOnce(new Error('WebView closed'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { await mapping.close(); } finally { warning.mockRestore(); }
  expect(listener.close).toHaveBeenCalledOnce();
  await routes.attach(tunnel(), 8001).setBrowserDomain?.('next.test');
  expect(configure).toHaveBeenLastCalledWith([{ domain: 'next.test', port: 8001 }]);
});
