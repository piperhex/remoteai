// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeChatTransport, type HostTransportEvent } from './nativeTransport';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { encodeBulkIpc } from './bulkIpc';

interface Batch { sequence: number; events: HostTransportEvent[] }
const state = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] as { onmessage: (batch: Batch) => void }[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke, Channel: class {
  onmessage = (_batch: Batch) => {};
  constructor() { state.channels.push(this); }
} }));
const hosts: NativeChatTransport[] = [];
const settle = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); state.channels = []; state.invoke.mockResolvedValue(undefined); });
afterEach(async () => { hosts.splice(0).forEach((host) => host.close()); await settle(); vi.unstubAllGlobals(); });
function host(receive = vi.fn()) {
  const transport = new NativeChatTransport(receive);
  hosts.push(transport);
  return transport;
}

it('never creates a browser socket or timer and attaches without exposing credentials', async () => {
  const websocket = vi.fn(); const interval = vi.spyOn(window, 'setInterval');
  vi.stubGlobal('WebSocket', websocket);
  host(); await settle();
  expect(state.invoke).toHaveBeenCalledWith('remote_chat_attach', {
    request: { clientId: expect.any(String) }, events: state.channels[0],
  });
  expect(websocket).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  interval.mockRestore();
});

it('acknowledges batches, ignores stale generations and sends only peer frames', async () => {
  const receive = vi.fn(); const transport = host(receive); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 3 }] });
  const frame = { type: 'relay', sessionId: 'phone', payload: 'aabb' };
  transport.send(frame); await settle();
  expect(state.invoke).toHaveBeenCalledWith('remote_chat_send', {
    request: { clientId: expect.any(String), generation: 3, message: frame },
  });
  state.channels[0].onmessage({ sequence: 2, events: [{ type: 'disconnected', generation: 2 }] });
  expect(transport.ready).toBe(true);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(state.invoke).toHaveBeenCalledWith('remote_chat_ack', {
    request: { clientId: expect.any(String), sequence: 2 },
  });
  expect(transport.bufferedAmount).toBe(0);
});

it('drops queued frames when the owner resets before IPC dispatch', async () => {
  const transport = host(); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 1 }] });
  transport.send({ type: 'relay', sessionId: 'old-phone', payload: 'aabb' });
  state.channels[0].onmessage({ sequence: 2, events: [{ type: 'reset', generation: 2 }] });
  await settle();
  expect(state.invoke.mock.calls.filter(([command]) => command === 'remote_chat_send')).toEqual([]);
  expect(transport.ready).toBe(false);
  expect(transport.bufferedAmount).toBe(0);
});

it('serializes rapid mount cleanup before attaching the replacement view', async () => {
  const first = host(); first.close(); const next = host(); await settle();
  expect(state.invoke.mock.calls.map(([command]) => command)).toEqual(['remote_chat_detach', 'remote_chat_attach']);
  state.channels[1].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 1 }] });
  expect(next.ready).toBe(true);
});

it('forgets a closed peer while offline so Rust cannot resume a destroyed encryption key', async () => {
  const transport = host(); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'disconnected', generation: 4 }] });
  transport.forgetSession('phone'); await settle();
  expect(state.invoke).toHaveBeenCalledWith('remote_chat_send', {
    request: { clientId: expect.any(String), generation: 4, message: { type: 'peer-close', sessionId: 'phone' } },
  });
});

it('keeps the host connected and drains queued chat frames after a diagnostic IPC rejection', async () => {
  const transport = host(); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 1 }] });
  state.invoke.mockRejectedValueOnce(new Error('unsupported diagnostic frame'));
  transport.send({ type: 'diagnostic', sessionId: 'phone', payload: { event: 'peer-created' } });
  const relay = { type: 'relay', sessionId: 'phone', payload: 'aabb' };
  transport.send(relay); await settle();
  expect(state.invoke).not.toHaveBeenCalledWith('remote_chat_reconnect', expect.anything());
  expect(transport.ready).toBe(true);
  expect(transport.bufferedAmount).toBe(0);
  expect(state.invoke).toHaveBeenLastCalledWith('remote_chat_send', {
    request: { clientId: expect.any(String), generation: 1, message: relay },
  });
});

it('still reconnects when a chat frame fails to cross IPC', async () => {
  const transport = host(); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 1 }] });
  state.invoke.mockRejectedValueOnce(new Error('transport unavailable'));
  transport.send({ type: 'relay', sessionId: 'phone', payload: 'aabb' }); await settle();
  expect(state.invoke).toHaveBeenCalledWith('remote_chat_reconnect', {
    request: { clientId: expect.any(String), generation: 1, reset: false },
  });
  expect(transport.ready).toBe(false);
  expect(transport.bufferedAmount).toBe(0);
});

it('submits one bounded binary batch with its generation and retains backpressure until native acknowledgement', async () => {
  const transport = host(); await settle();
  state.channels[0].onmessage({ sequence: 1, events: [{ type: 'ready', generation: 9 }] });
  const cipher = new BulkCipher(new Uint8Array(32).fill(5), { transferId: crypto.randomUUID(), epoch: crypto.randomUUID(),
    manifestId: 'f'.repeat(64), desktopKey: 'host', clientKey: 'viewer', sessionId: 'phone', desktop: true });
  const records = [0, 1].map(offset => cipher.encrypt({ requestId: crypto.randomUUID(), block: 0, offset }, Uint8Array.of(7)));
  let reject = (_error: Error) => {};
  state.invoke.mockImplementationOnce(() => new Promise<void>((_resolve, failed) => { reject = failed; }));
  const pending = transport.sendBulk('phone', records);
  const rejection = expect(pending).rejects.toThrow('socket gone');
  expect(transport.bufferedAmount).toBe(encodeBulkIpc('phone', records).length);
  expect(state.invoke).toHaveBeenLastCalledWith('remote_chat_bulk_send', encodeBulkIpc('phone', records), {
    headers: { 'x-file-bulk-client': expect.any(String), 'x-file-bulk-generation': '9' },
  });
  reject(new Error('socket gone')); await rejection;
  expect(transport.bufferedAmount).toBe(0);
  expect(() => encodeBulkIpc('phone', Array.from({ length: 17 }, () => records[0]))).toThrow();
});
