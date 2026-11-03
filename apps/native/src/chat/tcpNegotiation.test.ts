import { afterEach, expect, it, vi } from 'vitest';
import { MobileChatConnection } from './connection';
import type { AuthSession } from '../types';
import { getChatPolicy, setChatConnectionMode } from '../../../../shared/remote-chat/policy';

const platform = vi.hoisted(() => ({ OS: 'ios', constants: { Model: 'Test phone' } }));
vi.mock('react-native', () => ({ Platform: platform, NativeModules: {} }));
vi.mock('react-native-webrtc', () => ({ RTCPeerConnection: class {} }));
vi.mock('react-native-tcp-socket', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length).fill(7) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => {}) }));
vi.mock('../api/client', () => ({ fetchUserProfile: vi.fn(async () => ({})) }));

class Socket {
  static latest: Socket | undefined;
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.latest = this; Socket.instances.push(this); }
}
afterEach(() => {
  Socket.latest = undefined; Socket.instances = []; setChatConnectionMode('offline');
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['android', 'ios'])('uses shared backoff and cancels retries in the %s connection adapter', async os => {
  platform.OS = os; vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(1);
  vi.stubGlobal('WebSocket', Socket);
  const session = { baseUrl: 'http://fixture', accessToken: 'test-only-token' } as AuthSession;
  const connection = new MobileChatConnection({ session, deviceId: 'pc',
    mode: vi.fn(), ready: vi.fn(), event: vi.fn(), error: vi.fn() });
  try {
    connection.start(); await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1500, 3000, 6000]) {
      const count = Socket.instances.length;
      Socket.latest!.onopen?.(); Socket.latest!.onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(delay - 1); expect(Socket.instances).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(count + 1);
    }
    Socket.latest!.onclose?.({ code: 1006 }); connection.stop();
    await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  } finally { connection.stop(); }
});

it.each(['android', 'ios'])('advertises native TCP support in the authenticated %s wire handshake', async os => {
  platform.OS = os;
  vi.stubGlobal('WebSocket', Socket);
  const session = { baseUrl: 'https://example.test', accessToken: 'test-only-token' } as AuthSession;
  const connection = new MobileChatConnection({ session, deviceId: 'target-pc',
    mode: vi.fn(), ready: vi.fn(), event: vi.fn(), error: vi.fn() });
  try {
    setChatConnectionMode('direct');
    connection.start();
    expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
    await vi.waitFor(() => expect(Socket.latest?.onopen).toBeTypeOf('function'));
    const socket = Socket.latest!;
    socket.onopen?.();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      deviceId: 'target-pc', tcpPunch: true, transportVersion: 2,
      clientInfo: { platform: os === 'ios' ? 'iOS' : 'Android' },
    });
  } finally { connection.stop(); }
  expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
});
