import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileRelay } from '../../../../shared/remote-chat/fileRelay';
import { BulkTransport } from '../../../../shared/remote-chat/bulkTransport';
import type { ChatSocket } from '../../../../shared/remote-chat/client/socket';

class Socket implements ChatSocket {
  readyState = 1; bufferedAmount = 0;
  onopen: ChatSocket['onopen'] = null; onclose: ChatSocket['onclose'] = null;
  onerror: ChatSocket['onerror'] = null; onmessage: ChatSocket['onmessage'] = null;
  onbulk: ChatSocket['onbulk'] = null;
  send = vi.fn((_data: string) => {});
  sendBulk = vi.fn(async (_id: string, _records: readonly Uint8Array[]) => {}); close = vi.fn();
  ready() { this.onmessage?.({ data: JSON.stringify({ type: 'file-relay-ready', sessionId: 'session' }) }); }
}
const relays: FileRelay[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { relays.splice(0).forEach(relay => relay.close()); vi.useRealTimers(); });
function fixture() {
  const sockets: Socket[] = []; const urls: string[] = [];
  const fallback = { available: () => true, send: vi.fn(async () => {}) };
  const changed = vi.fn(), record = vi.fn();
  const relay = new FileRelay({ url: () => 'wss://cloud.test/api/device-chat', sessionId: 'session',
    createSocket: url => { urls.push(url); const socket = new Socket(); sockets.push(socket); return socket; },
    fallback, changed, record, quota: vi.fn() });
  relays.push(relay);
  relay.configure({ version: 1, ticket: 'capability' });
  sockets[0].onopen?.();
  return { relay, sockets, urls, fallback, changed, record };
}
it('authenticates only the file capability and never falls back while its dedicated socket is connecting', async () => {
  const test = fixture();
  expect(test.urls).toEqual(['wss://cloud.test/api/device-chat?channel=file']);
  expect(JSON.parse(test.sockets[0].send.mock.calls[0][0])).toEqual({ type: 'file-relay-authenticate',
    sessionId: 'session', ticket: 'capability' });
  expect(test.relay.available()).toBe(false);
  await expect(test.relay.send(Uint8Array.of(1))).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  expect(test.fallback.send).not.toHaveBeenCalled();
  test.sockets[0].ready(); await test.relay.send(Uint8Array.of(1));
  expect(test.sockets[0].sendBulk).toHaveBeenCalledWith('session', [Uint8Array.of(1)]);
});
it('recovers only the file socket and fences stale callbacks after ticket rotation', async () => {
  const test = fixture(), old = test.sockets[0];
  old.ready(); const stale = old.onbulk;
  test.relay.configure({ version: 1, ticket: 'renewed' });
  expect(old.close).toHaveBeenCalledOnce();
  stale?.('session', Uint8Array.of(1)); expect(test.record).not.toHaveBeenCalled();
  const next = test.sockets[1]; next.ready(); next.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(test.sockets).toHaveLength(3); expect(test.fallback.send).not.toHaveBeenCalled();
  test.relay.close(); await vi.advanceTimersByTimeAsync(30_000);
  expect(test.sockets).toHaveLength(3);
});
it('isolates a malformed file session and preserves compatibility when no capability was issued', async () => {
  const test = fixture(); test.sockets[0].ready();
  test.sockets[0].onbulk?.('wrong-session', Uint8Array.of(1));
  expect(test.relay.available()).toBe(false); expect(test.record).not.toHaveBeenCalled();
  const fallback = { available: () => true, send: vi.fn(async () => {}) };
  const legacy = new FileRelay({ url: () => '', sessionId: 'legacy', fallback,
    record: vi.fn(), changed: vi.fn(), quota: vi.fn() }); relays.push(legacy);
  await legacy.send(Uint8Array.of(1)); expect(fallback.send).toHaveBeenCalledOnce();
});
it('waits for a dedicated file path and supports cancellation instead of choosing chat RPC', async () => {
  const test = fixture(); const transport = new BulkTransport(test.relay); transport.setMode('relay');
  const signal = new AbortController(); const prepared = transport.prepare(signal.signal);
  const rejection = expect(prepared).rejects.toMatchObject({ code: 'CANCELLED' });
  signal.abort(); await vi.advanceTimersByTimeAsync(25); await rejection;
  test.sockets[0].ready(); await transport.prepare(); transport.close();
  expect(transport.path).toBeUndefined();
});
