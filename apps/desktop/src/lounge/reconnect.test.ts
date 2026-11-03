import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistorySyncConnection, type LoungeSyncTransport } from '../../../../shared/lounge/syncConnection';
import { AttachmentConnection } from '../../../../shared/lounge/attachmentConnection';
import { LoungeController } from '../../../../shared/lounge/controller';
import { SyncArchive } from '../../../../shared/lounge/syncArchive';
import type { ChatSocket } from '../../../../shared/remote-chat/client/socket';

class Socket implements ChatSocket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  fail() { this.onclose?.({ code: 1006 }); }
}
const active: { stop: () => void }[] = [];
const transport: LoungeSyncTransport = {
  randomBytes: length => new Uint8Array(length).fill(1), retryRandom: () => 1,
  createPeer: () => { throw new Error('Unexpected P2P attempt in authentication fixture'); },
  createSocket: () => new Socket(),
};
function sync(authorize = async () => ({ ticket: 'test' })) {
  const archive = new SyncArchive({ owner: 'self', store: { save: async () => {},
    page: async () => ({ messages: [] }) }, flush: async () => {}, restored: () => {}, current: () => true,
    accept: () => true });
  return new HistorySyncConnection({ baseUrl: 'http://fixture', deviceId: 'pc', transport, archive,
    authorize, error: () => {} });
}
function attachments(authorize = async () => ({ ticket: 'test' })) {
  return new AttachmentConnection({ baseUrl: 'http://fixture', deviceId: 'pc', transport, authorize,
    source: async () => undefined });
}
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { active.splice(0).forEach(client => client.stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([{ create: sync, initial: 1000 }, { create: attachments, initial: 2000 }])(
  'backs off lounge transport failures ($initial ms window) until sync registration', async ({ create, initial }) => {
    const client = create(); active.push(client); client.start(); await vi.advanceTimersByTimeAsync(0);
    for (const delay of [initial, initial * 2, initial * 4]) {
      const count = Socket.instances.length, socket = Socket.instances.at(-1)!;
      const staleClose = socket.onclose!;
      socket.onopen?.(); socket.fail(); staleClose({ code: 1006 });
      await vi.advanceTimersByTimeAsync(delay - 1); expect(Socket.instances).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(count + 1);
    }
    Socket.instances.at(-1)!.receive({ type: 'sync-registered' }); Socket.instances.at(-1)!.fail();
    await vi.advanceTimersByTimeAsync(initial); expect(Socket.instances).toHaveLength(5);
    client.stop(); await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(5); expect(vi.getTimerCount()).toBe(0);
  });

it.each([sync, attachments])('ignores authorization finishing after a lounge connection stops', async create => {
  let finish!: (value: { ticket: string }) => void;
  const client = create(() => new Promise(resolve => { finish = resolve; })); active.push(client);
  client.start(); client.stop(); finish({ ticket: 'stale' });
  await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([{ create: sync, initial: 1000 }, { create: attachments, initial: 2000 }])(
  'manual lounge transport retry skips one wait ($initial ms window)', async ({ create, initial }) => {
  const client = create(); active.push(client); client.start(); await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].fail(); client.retryNow(); client.retryNow();
  await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(2);
  Socket.instances[1].fail();
  await vi.advanceTimersByTimeAsync(initial * 2 - 1); expect(Socket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(3);
});

it('network wake also recovers the live history and attachment subscriptions exactly once', async () => {
  let wake!: () => void;
  const client = new LoungeController({ baseUrl: 'http://fixture', authorize: async () => ({ ticket: 'test' }),
    sync: transport, history: { save: async () => {}, get: async () => undefined, page: async () => ({ messages: [] }) } },
    { retryRandom: () => 1, isVisible: () => true, randomId: () => 'id',
      subscribe: listener => { wake = listener; return () => {}; } });
  active.push(client); client.start(); await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].receive({ type: 'ready', attachments: true, deviceSync: true,
    user: { id: 'self', account: 'self@test' } });
  await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(3);
  Socket.instances.forEach(socket => socket.fail()); wake(); wake();
  await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(6);
  client.stop(); wake(); await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(6); expect(vi.getTimerCount()).toBe(0);
});

it('lounge wake is immediate but does not clear failures, overlap handshakes, or restart after stop', async () => {
  let wake!: () => void;
  const client = new LoungeController({ baseUrl: 'http://fixture', authorize: async () => ({ ticket: 'test' }) },
    { retryRandom: () => 1, isVisible: () => true, randomId: () => 'id',
      subscribe: listener => { wake = listener; return () => {}; } });
  active.push(client); client.start(); await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onopen?.(); Socket.instances[0].fail();
  wake(); wake(); await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(2);
  Socket.instances[1].onopen?.(); Socket.instances[1].fail();
  await vi.advanceTimersByTimeAsync(1999); expect(Socket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(3);
  Socket.instances[2].receive({ type: 'ready', user: { id: 'self', account: 'self@test' } });
  Socket.instances[2].fail(); await vi.advanceTimersByTimeAsync(1000); expect(Socket.instances).toHaveLength(4);
  client.stop(); wake(); await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(4);
});
