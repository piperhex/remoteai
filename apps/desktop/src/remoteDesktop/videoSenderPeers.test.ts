import { afterEach, expect, it, vi } from 'vitest';
import { BrowserDesktopDirectHost } from './directHost';
import { BrowserDesktopRelayHost } from './relayHost';
import type { DesktopSignal } from '../../../../shared/remote-desktop/protocol';

function connection(kind: 'direct' | 'relay') {
  const track = { kind: 'video' };
  const parameters = { encodings: [{ maxBitrate: 8_000_000 }], degradationPreference: 'balanced' };
  const sender = { track, getParameters: vi.fn(() => parameters), setParameters: vi.fn(async () => {}),
    replaceTrack: vi.fn(async () => {}) };
  const channel = { readyState: 'open', send: vi.fn() };
  const pc = { createDataChannel: () => channel, addTrack: () => sender, getSenders: () => [sender],
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer' })), setLocalDescription: vi.fn(async () => {}),
    addEventListener: vi.fn(), close: vi.fn() };
  vi.stubGlobal('RTCPeerConnection', vi.fn(function () { return pc; }));
  const options = { iceServers: [{ urls: 'turn:relay.test' }],
    stream: () => ({ getTracks: () => [track] }) as unknown as MediaStream,
    current: () => pc as unknown as RTCPeerConnection, bind: vi.fn(), activate: vi.fn() };
  const host = kind === 'direct' ? new BrowserDesktopDirectHost(options) : new BrowserDesktopRelayHost(options);
  const upgrade = { action: 'start', generation: 1 } as const;
  const signal: DesktopSignal = { candidates: [],
    ...(kind === 'direct' ? { directUpgrade: upgrade } : { relayStandby: upgrade }) };
  return { host, signal, sender, pc };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['direct', 'relay'] as const)('preserves resolution before a new %s offer can be used', async kind => {
  vi.useFakeTimers();
  const { host, signal, sender, pc } = connection(kind);
  try {
    await expect(host.signal(signal)).resolves.toMatchObject({ sdp: 'offer' });
    expect(sender.setParameters).toHaveBeenCalledExactlyOnceWith({
      encodings: [{ maxBitrate: 8_000_000 }], degradationPreference: 'maintain-resolution',
    });
    expect(pc.setLocalDescription.mock.invocationCallOrder[0])
      .toBeLessThan(sender.setParameters.mock.invocationCallOrder[0]);
  } finally { host.close(); }
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['direct', 'relay'] as const)('closes a new %s connection if resolution protection fails', async kind => {
  vi.useFakeTimers();
  const { host, signal, sender, pc } = connection(kind);
  sender.setParameters.mockRejectedValueOnce(new Error('sender configuration failed'));
  try {
    await expect(host.signal(signal)).rejects.toThrow('sender configuration failed');
    expect(pc.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally { host.close(); }
});
