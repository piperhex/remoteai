import { expect, it, vi } from 'vitest';
import { nativeBrowserSession } from '../../../../../shared/browser/managed/providerBrowserSession';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const request = { url: 'https://example.test', headers: {}, headerOrigin: '', visible: true, navigate: true,
  bounds: { x: 0, y: 0, width: 800, height: 600 } };

it('coalesces resizes and waits for native creation before closing the tab', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const session = nativeBrowserSession('tab', vi.fn());
  session.update(request);
  session.update({ ...request, bounds: { ...request.bounds, width: 900 } });
  const closing = session.close();
  expect(invoke).toHaveBeenCalledTimes(1);
  finish(); await closing;
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(['provider_browser_sync', 'provider_browser_close']);
});

it('does not navigate again on a resize and exposes native platform errors', async () => {
  invoke.mockReset().mockResolvedValue(undefined);
  const fail = vi.fn();
  const session = nativeBrowserSession('tab', fail);
  session.update(request); await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  session.update({ ...request, bounds: { ...request.bounds, width: 900 } });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1].request.navigate).toBe(false);
  invoke.mockRejectedValueOnce('market.browserHeadersUnsupported');
  await Promise.resolve(); session.update({ ...request, url: 'https://other.test' });
  await vi.waitFor(() => expect(fail).toHaveBeenCalledWith('market.browserHeadersUnsupported'));
  await session.close();
});
