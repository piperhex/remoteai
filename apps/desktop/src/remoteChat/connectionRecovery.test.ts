import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatConnection } from '../../../../shared/remote-chat/client/connection';
import type { LinkOptions } from '../../../../shared/remote-chat/linkOptions';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';
import type { TransferProgress } from '../../../../shared/remote-chat/uploadProgress';
import { getChatPolicy, DEFAULT_CHAT_POLICY } from '../../../../shared/remote-chat/policy';

const state = vi.hoisted(() => ({ options: undefined as LinkOptions | undefined,
  send: vi.fn(async (_message: RpcMessage, _progress?: TransferProgress) => undefined),
  relay: vi.fn(), close: vi.fn(), renew: vi.fn() }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  resumable = true;
  constructor(options: LinkOptions) { state.options = options; }
  offer = async () => undefined;
  send = state.send;
  setRelayAvailable = state.relay;
  renew = state.renew;
  close = state.close;
} }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
let connection: ChatConnection;
const mode = vi.fn();
const ready = vi.fn();
const error = vi.fn();
const upload = vi.fn();
const renewAuthorization = vi.fn(async (): Promise<void> => undefined);
const credentials = { baseUrl: 'https://test', accessToken: 'token' };
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000); vi.clearAllMocks();
  renewAuthorization.mockReset().mockResolvedValue(undefined);
  credentials.accessToken = 'token';
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  connection = new ChatConnection({ deviceId: 'pc', mode, ready, error, upload, event: vi.fn(), renewAuthorization,
    authorize: async () => credentials,
    randomBytes: (size) => new Uint8Array(size).fill(1),
    createPeer: () => { throw new Error('unused'); },
  });
  connection.start();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onopen?.();
  Socket.instances[0].receive({ type: 'paired', sessionId: 'session', resumeToken: 'ab'.repeat(32),
    transportVersion: 2, iceServers: [], expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(0);
  state.options!.mode('direct');
});
afterEach(() => { connection.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('applies the initial authenticated lease to the created transport', () => {
  expect(state.renew).toHaveBeenCalledWith(Date.now() + 120_000);
});

it('skips socket backoff on foreground return without reinitializing chat or overlapping handshakes', async () => {
  Socket.instances[0].onclose?.({ code: 1006 });
  connection.retryNow();
  connection.retryNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(Socket.instances).toHaveLength(2);
  const resumed = Socket.instances[1];
  resumed.onopen?.();
  expect(JSON.parse(resumed.send.mock.calls[0][0])).toMatchObject({ resume: { sessionId: 'session' } });
  resumed.receive({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(1500);
  connection.retryNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(Socket.instances).toHaveLength(2);
  expect(state.close).not.toHaveBeenCalled();
  expect(ready).toHaveBeenCalledOnce();
});

it('negotiates diagnostics per socket and disables them again when reconnecting to an older server', async () => {
  expect(state.options!.diagnosticsEnabled?.()).toBe(false);
  Socket.instances[0].receive({ type: 'chat-policy', policy: DEFAULT_CHAT_POLICY, connectionDiagnostics: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.options!.diagnosticsEnabled?.()).toBe(true);
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  expect(state.options!.diagnosticsEnabled?.()).toBe(false);
  Socket.instances[1].receive({ type: 'chat-policy', policy: DEFAULT_CHAT_POLICY });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.options!.diagnosticsEnabled?.()).toBe(false);
});

it('publishes individual image changes within one total percent and ignores replayed progress', async () => {
  const request = connection.request('request', { images: ['data:image/png;base64,YWJj'] });
  const [message, report] = state.send.mock.calls.at(-1)!;
  report?.(0.501, [{ kind: 'image', index: 0, percent: 1 }]);
  report?.(0.502, [{ kind: 'image', index: 0, percent: 2 }]);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload).toHaveBeenLastCalledWith({ phase: 'uploading', percent: 50,
    items: [{ kind: 'image', index: 0, percent: 2 }] });
  report?.(0.502, [{ kind: 'image', index: 0, percent: 2 }]);
  report?.(0.1, [{ kind: 'image', index: 0, percent: 0 }]);
  expect(upload).toHaveBeenCalledTimes(2);
  report?.(1, [{ kind: 'image', index: 0, percent: 100 }]);
  expect(upload).toHaveBeenLastCalledWith({ phase: 'confirming', percent: 100,
    items: [{ kind: 'image', index: 0, percent: 100 }] });
  if (message.kind !== 'request') throw new Error('Expected upload request');
  state.options!.message({ kind: 'response', id: message.id, data: true });
  await expect(request).resolves.toBe(true);
});

it('updates client transfer allowances before mode notifications and restores them on stop', () => {
  expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
  state.options!.mode('relay');
  expect(getChatPolicy().fileUploadMaxMb).toBe(DEFAULT_CHAT_POLICY.fileUploadMaxMb);
  state.options!.mode('direct');
  connection.stop();
  expect(getChatPolicy().fileUploadMaxMb).toBe(DEFAULT_CHAT_POLICY.fileUploadMaxMb);
});

it('keeps background device lifecycle changes from changing the visible device transfer limits', async () => {
  const background = new ChatConnection({ deviceId: 'background-pc', managePolicyMode: false,
    mode: vi.fn(), ready: vi.fn(), error: vi.fn(), event: vi.fn(),
    authorize: async () => ({ baseUrl: 'https://test', accessToken: 'token' }),
    randomBytes: size => new Uint8Array(size).fill(2), createPeer: () => { throw new Error('unused'); } });
  try {
    background.start();
    expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
    await vi.advanceTimersByTimeAsync(0);
    Socket.instances[1].receive({ type: 'paired', sessionId: 'background-session', transportVersion: 2,
      iceServers: [], expiresAt: Date.now() + 120_000 });
    await vi.advanceTimersByTimeAsync(0);
    state.options!.mode('relay');
    expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
  } finally { background.stop(); }
  expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
});

it('retains pending requests, readiness and the same session while resuming a failed coordinator socket', async () => {
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const request = state.send.mock.calls[0][0] as { id: string };
  const first = Socket.instances[0];
  first.onclose?.({ code: 1006 });
  expect(state.close).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  const second = Socket.instances[1];
  second.onopen?.();
  expect(JSON.parse(second.send.mock.calls[0][0])).toMatchObject({
    resume: { sessionId: 'session', resumeToken: 'ab'.repeat(32) },
  });
  second.receive({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 120_000 });
  first.onclose?.({ code: 4001 });
  state.options!.mode('relay');
  state.options!.message({ kind: 'response', id: request.id, data: 'accepted' });
  expect(await pending).toBe('accepted');
  expect(state.send).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(state.relay).toHaveBeenLastCalledWith(true);
  expect(mode.mock.calls.flat()).not.toContain('offline');
});

it('still terminates P2P on authorization rejection or lease expiry', async () => {
  Socket.instances[0].onclose?.({ code: 4001 });
  expect(state.close).toHaveBeenCalledOnce();
  expect(mode).toHaveBeenLastCalledWith('offline');
  connection.stop();
  expect(vi.getTimerCount()).toBe(0);
});

async function reconnectSocket(delay = 1500) {
  await vi.advanceTimersByTimeAsync(delay);
  const socket = Socket.instances.at(-1)!;
  socket.onopen?.();
  return socket;
}

it('pairs again after repeated missing-session replies without restarting or replaying a pending request', async () => {
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const rejected = expect(pending).rejects.toThrow();
  Socket.instances[0].onclose?.({ code: 1006 });
  const first = await reconnectSocket();
  first.onclose?.({ code: 4004 });
  expect(state.close).not.toHaveBeenCalled();
  const second = await reconnectSocket(3000);
  expect(JSON.parse(second.send.mock.calls[0][0])).toHaveProperty('resume.sessionId', 'session');
  second.onclose?.({ code: 4004 });
  expect(state.close).toHaveBeenCalledOnce();
  await rejected;
  const fresh = await reconnectSocket();
  expect(JSON.parse(fresh.send.mock.calls[0][0])).not.toHaveProperty('resume');
  first.onclose?.({ code: 4004 });
  fresh.receive({ type: 'paired', sessionId: 'replacement', resumeToken: 'cd'.repeat(32),
    transportVersion: 2, iceServers: [], expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(0);
  state.options!.mode('relay');
  expect(ready).toHaveBeenCalledTimes(2);
  expect(state.send).toHaveBeenCalledOnce();
  expect(state.close).toHaveBeenCalledOnce();
  expect(mode).toHaveBeenLastCalledWith('relay');
});

it('preserves the original session while the PC briefly restores it and resets the rejection count on resume', async () => {
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const request = state.send.mock.calls[0][0] as { id: string };
  for (let outage = 0; outage < 2; outage += 1) {
    Socket.instances.at(-1)!.onclose?.({ code: 1006 });
    const waiting = await reconnectSocket();
    waiting.onclose?.({ code: 4004 });
    const resumed = await reconnectSocket(3000);
    expect(JSON.parse(resumed.send.mock.calls[0][0])).toHaveProperty('resume.sessionId', 'session');
    resumed.receive({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 120_000 });
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(state.close).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  state.options!.message({ kind: 'response', id: request.id, data: 'accepted' });
  await expect(pending).resolves.toBe('accepted');
  expect(ready).toHaveBeenCalledOnce();
});

it('renews before expiry and preserves P2P, pending requests and the authenticated session', async () => {
  renewAuthorization.mockImplementationOnce(async () => { credentials.accessToken = 'renewed-token'; });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(renewAuthorization).not.toHaveBeenCalled();
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const request = state.send.mock.calls.at(-1)![0] as { id: string };
  await vi.advanceTimersByTimeAsync(1501);
  expect(renewAuthorization).toHaveBeenCalledOnce();
  expect(state.close).not.toHaveBeenCalled();
  const socket = Socket.instances[1];
  socket.onopen?.();
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
    accessToken: 'renewed-token', resume: { sessionId: 'session' },
  });
  socket.receive({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 900_000 });
  await vi.advanceTimersByTimeAsync(0);
  state.options!.message({ kind: 'response', id: request.id, data: 'accepted' });
  await expect(pending).resolves.toBe('accepted');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(ready).toHaveBeenCalledOnce();
  expect(state.close).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(mode.mock.calls.flat()).not.toContain('offline');
});

it('renews Relay on the same socket without pausing pending requests when the server supports it', async () => {
  const socket = Socket.instances[0];
  socket.receive({ type: 'chat-policy', policy: DEFAULT_CHAT_POLICY, authRenewal: true });
  state.options!.mode('relay');
  renewAuthorization.mockImplementationOnce(async () => { credentials.accessToken = 'renewed-token'; });
  await vi.advanceTimersByTimeAsync(59_999);
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const request = state.send.mock.calls.at(-1)![0] as { id: string };
  await vi.advanceTimersByTimeAsync(1);
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ type: 'renew-auth', accessToken: 'renewed-token' });
  expect(socket.close).not.toHaveBeenCalled();
  expect(state.relay).not.toHaveBeenCalled();
  socket.receive({ type: 'resumed', renewed: true, sessionId: 'session', expiresAt: Date.now() + 900_000 });
  socket.receive({ type: 'auth-renewed', expiresAt: Date.now() + 900_000 });
  await vi.advanceTimersByTimeAsync(0);
  state.options!.message({ kind: 'response', id: request.id, data: 'accepted' });
  await expect(pending).resolves.toBe('accepted');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(state.relay).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it('recovers a missing renewal acknowledgement without dropping the encrypted session', async () => {
  const socket = Socket.instances[0];
  socket.receive({ type: 'chat-policy', policy: DEFAULT_CHAT_POLICY, authRenewal: true });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(socket.close).toHaveBeenCalledOnce();
  expect(state.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  expect(Socket.instances).toHaveLength(2);
});

it('keeps renewal valid when the coordinator reconnects during the credential refresh', async () => {
  let finish!: () => void;
  renewAuthorization.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(60_000);
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  const reconnecting = Socket.instances[1];
  finish();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reconnecting.close).toHaveBeenCalledOnce();
  expect(Socket.instances).toHaveLength(3);
  expect(state.close).not.toHaveBeenCalled();
});

it('keeps a healthy connection while renewal is pending and ignores its result after logout', async () => {
  let finish!: () => void;
  renewAuthorization.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances[0].close).not.toHaveBeenCalled();
  connection.stop();
  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('retries a transient renewal failure without closing P2P but stops on revoked credentials', async () => {
  renewAuthorization.mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce({ status: 401 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances[0].close).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.close).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalled();
});

it('does not cancel a stalled socket handshake timeout when the data path changes', async () => {
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  const stalled = Socket.instances[1];
  state.options!.mode('relay');
  await vi.advanceTimersByTimeAsync(30_001);
  expect(stalled.close).toHaveBeenCalledOnce();
  expect(state.close).not.toHaveBeenCalled();
});

it('expires the authenticated session even when the coordinator is unreachable', async () => {
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(state.close).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalled();
});

it('explicitly releases a relay-only session on logout and ignores callbacks from old sockets', async () => {
  const first = Socket.instances[0];
  connection.stop();
  expect(first.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'peer-close', sessionId: 'session' }));
  first.onopen?.();
  first.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
