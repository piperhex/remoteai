import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findUpdatePeers } from '../../../../shared/app-update/peerLookup';

class Socket {
  static latest: Socket;
  onopen = () => {}; onerror = () => {}; onclose = () => {};
  onmessage = (_event: { data: string }) => {};
  send = vi.fn(); close = vi.fn();
  constructor(readonly url: string) { Socket.latest = this; }
  receive(message: object) { this.onmessage({ data: JSON.stringify(message) }); }
}
const artifact = 'a'.repeat(64);
const session = { baseUrl: 'https://example.test/api', accessToken: 'token' };
function config(index: number) {
  return { sessionId: `update-00000000-0000-4000-8000-00000000000${index}`, secret: 'b'.repeat(64),
    desktop: false, expiresAt: Date.now() + 60_000, servers: ['tcp://test:1'], stunServers: [] };
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('authenticates before requesting distinct sources and keeps the lease until the receiver closes it', async () => {
  const result = findUpdatePeers(session, artifact);
  const socket = Socket.latest;
  socket.onopen();
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'subscribe-devices', accessToken: 'token' });
  socket.receive({ type: 'devices-snapshot', devices: [] });
  expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({ type: 'update-peer-find', maxPeers: 3 });
  socket.receive({ type: 'update-peer-offers', requestId: 'android-update', artifact, configs: [config(1), config(2)] });
  const lease = await result;
  expect(lease.configs).toHaveLength(2);
  expect(socket.close).not.toHaveBeenCalled();
  lease.close(); expect(socket.close).toHaveBeenCalledOnce();
});

it.each(['timeout', 'wrong-artifact', 'duplicate', 'expired', 'unavailable'])('cleans up after %s', async failure => {
  const result = findUpdatePeers(session, artifact);
  const rejected = expect(result).rejects.toThrow('Update sharing unavailable');
  const socket = Socket.latest;
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(6_000);
  else socket.receive({ type: failure === 'unavailable' ? 'update-peer-unavailable' : 'update-peer-offers',
    requestId: 'android-update', artifact: failure === 'wrong-artifact' ? 'c'.repeat(64) : artifact,
    configs: failure === 'duplicate' ? [config(1), config(1)] : [{ ...config(1), expiresAt: 1 }],
  });
  await rejected;
  expect(socket.close).toHaveBeenCalledOnce();
});
