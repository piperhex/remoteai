import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDesktopPeer } from './peer';
import type { Peer, PeerOptions } from '../../../../shared/remote-chat/protocol';

const state = vi.hoisted(() => ({ listen: vi.fn(), connect: vi.fn(), close: vi.fn(), network: vi.fn() }));
vi.mock('./tcpNetwork', () => ({ DesktopTcpNetwork: class {
  listen = state.listen; connect = state.connect; close = state.close;
  constructor(session: string, generation: number) { state.network(session, generation); }
} }));
const peers: Peer[] = [];
vi.mock('../nativeRtc/connection', () => ({ createNativeRtcConnection: () => { throw new Error('RTC unavailable'); } }));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  state.listen.mockRejectedValue(new Error('Network unavailable'));
  vi.stubGlobal('RTCPeerConnection', class { constructor() { throw new Error('RTC unavailable'); } });
});
afterEach(() => { peers.splice(0).forEach(peer => peer.close()); vi.unstubAllGlobals(); vi.useRealTimers(); });

function options(desktop: boolean): PeerOptions {
  return { sessionId: 'session', generation: 8, desktop, iceServers: [],
    tcp: { servers: [{ host: 'discovery.example', port: 3478 }] },
    signal: vi.fn(), channel: vi.fn(), disconnected: vi.fn() };
}

it.each([false, true])('starts TCP for PC role desktop=%s even if WebRTC cannot start', async desktop => {
  const config = options(desktop);
  const peer = createDesktopPeer(config); peers.push(peer);
  await peer.offer();
  expect(config.signal).toHaveBeenCalledWith({ kind: 'tcp', publicKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    addresses: [] });
  expect(config.channel).toHaveBeenCalledOnce();
  expect(state.network).toHaveBeenCalledWith('session', 8);
  expect(state.listen).toHaveBeenCalledWith(false, expect.any(Function));
  peer.close();
  expect(state.close).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start TCP against an older peer that did not negotiate it', () => {
  expect(() => createDesktopPeer({ ...options(false), tcp: undefined })).toThrow('RTC unavailable');
  expect(state.network).not.toHaveBeenCalled();
});
