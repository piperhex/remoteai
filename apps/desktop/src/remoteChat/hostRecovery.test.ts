// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LinkOptions } from '../../../../shared/remote-chat/linkOptions';
import type { HostTransportEvent } from './nativeTransport';
import { ChatHost } from './host';

const state = vi.hoisted(() => ({ options: undefined as LinkOptions | undefined,
  receive: undefined as ((event: HostTransportEvent) => void) | undefined,
  relay: vi.fn(), close: vi.fn(), reconnect: vi.fn(), stop: vi.fn(), registerDesktop: vi.fn(), renew: vi.fn(),
  execute: vi.fn(async () => ({})) }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { subscribe: vi.fn(async () => vi.fn()) } }));
vi.mock('../pages/codexGui/webEvents', () => ({ subscribeGuiEvent: vi.fn(async () => vi.fn()) }));
vi.mock('./operations', () => ({ ChatOperations: class {
  release = vi.fn(); execute = state.execute;
  desktop = { register: state.registerDesktop, diagnose: vi.fn(), nativeMedia: vi.fn() };
} }));
vi.mock('./nativeTransport', () => ({ NativeChatTransport: class {
  ready = true; bufferedAmount = 0;
  constructor(receive: (event: HostTransportEvent) => void) { state.receive = receive; }
  send = vi.fn(); forgetSession = vi.fn(); reconnect = state.reconnect; close = state.stop;
} }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  constructor(options: LinkOptions) { state.options = options; }
  setRelayAvailable = state.relay;
  renew = state.renew;
  send = vi.fn(async () => {});
  close = state.close;
} }));

const changed = vi.fn();
let host: ChatHost;
const message = (data: object, generation = 1) => state.receive!({
  type: 'message', generation, data: JSON.stringify(data),
});

it('refreshes desktop relay credentials for existing chats without closing their media', () => {
  const ice = [{ urls: 'turn:example.test:3479', username: 'renewed', credential: 'test-only' }];
  message({ type: 'desktop-ice', desktopIceServers: ice });
  expect(state.registerDesktop).toHaveBeenLastCalledWith('session', ice);
  expect(state.close).not.toHaveBeenCalled();
});

it('forwards only the native identity as the persistent terminal owner', async () => {
  message({ type: 'peer-open', sessionId: 'terminal-session', publicKey: 'ab'.repeat(32), iceServers: [],
    terminalOwner: 'native-account-scope' });
  const request = { kind: 'request' as const, method: 'request' as const, id: 'request',
    body: { operation: 'guiTerminalList', terminalOwner: 'forged' } };
  state.options!.message(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.execute).toHaveBeenCalledWith(request, undefined, 'terminal-session', 'native-account-scope');
});
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000); vi.clearAllMocks();
  host = new ChatHost(changed);
  message({ type: 'peer-open', sessionId: 'session', publicKey: 'ab'.repeat(32), iceServers: [],
    transportVersion: 2, resumeToken: 'cd'.repeat(32), expiresAt: Date.now() + 120_000 });
  state.options!.mode('direct');
  await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => { host.close(); vi.useRealTimers(); });

it('applies the initial authenticated lease after constructing the desktop link', () => {
  expect(state.renew).toHaveBeenCalledWith(Date.now() + 120_000);
});

it('never lets an individual viewer timeout reset the shared native transport', () => {
  state.options!.reconnectRelay?.();
  expect(state.reconnect).not.toHaveBeenCalled();
});

it('extends a renewed lease while leaving the healthy relay path and requests available', () => {
  state.options!.mode('relay');
  message({ type: 'resumed', renewed: true, sessionId: 'session', expiresAt: Date.now() + 900_000 });
  expect(state.renew).toHaveBeenLastCalledWith(Date.now() + 900_000);
  expect(state.relay).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
  expect(state.reconnect).not.toHaveBeenCalled();
});

it('preserves direct sessions while Rust reconnects and restores the relay on a resume notification', () => {
  state.receive!({ type: 'disconnected', generation: 2 });
  expect(state.relay).toHaveBeenLastCalledWith(false);
  expect(state.close).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith(true);
  state.receive!({ type: 'ready', generation: 2 });
  message({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 120_000 }, 2);
  expect(state.relay).toHaveBeenLastCalledWith(true);
  expect(state.close).not.toHaveBeenCalled();
});

it('clears old sessions on logout or owner changes without stopping the native host', () => {
  state.receive!({ type: 'reset', generation: 2 });
  expect(state.close).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(state.stop).not.toHaveBeenCalled();
  message({ type: 'peer-open', sessionId: 'new-session', publicKey: 'ab'.repeat(32), iceServers: [] }, 2);
  state.options!.mode('relay');
  expect(changed).toHaveBeenLastCalledWith(true);
});

it('asks Rust to reset an invalid protocol session and keeps the host recoverable', async () => {
  state.receive!({ type: 'message', generation: 1, data: 'invalid json' });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.reconnect).toHaveBeenCalledWith(true);
  expect(state.stop).not.toHaveBeenCalled();
});

it('keeps the original expiry deadline when the coordinator cannot renew the session', async () => {
  state.receive!({ type: 'disconnected', generation: 2 });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(state.close).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenLastCalledWith(false);
});
