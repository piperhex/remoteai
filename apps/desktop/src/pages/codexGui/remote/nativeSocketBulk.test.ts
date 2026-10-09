import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, type Channel } from '@tauri-apps/api/core';
import { NativeGuiSocket } from './nativeSocket';
import { decodeGuiBulkBatch } from './nativeBulkSocket';
import { BulkCipher } from '../../../../../../shared/remote-chat/bulkCipher';
import { encodeBulkRelay } from '../../../../../../shared/remote-chat/bulkRelayWire';
import { BulkTransport } from '../../../../../../shared/remote-chat/bulkTransport';
import { downloadBulkClient } from '../../../../../../shared/remote-chat/client/bulkClient';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../../../shared/remote-chat/policy';
import type { ChatLink } from '../../../../../../shared/remote-chat/link';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage = (_value: unknown) => {}; } }));
const sockets: NativeGuiSocket[] = [];
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue(undefined); });
afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.close());
  setChatPolicy(DEFAULT_CHAT_POLICY); await flush();
});

async function connect() {
  const socket = new NativeGuiSocket({ baseUrl: 'https://cloud.example', userId: 'owner' });
  sockets.push(socket);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', deviceId: 'pc', publicKey: 'ab'.repeat(32) }));
  await flush();
  const { events, request } = vi.mocked(invoke).mock.calls.find(([name]) => name === 'gui_remote_open')![1] as {
    events: Channel<unknown>; request: { bulkEvents: Channel<ArrayBuffer> };
  };
  const negotiate = (enabled: boolean) => events.onmessage({ sequence: 1, events: [
    { type: 'message', data: JSON.stringify({ type: 'chat-policy', fileBulkV1: enabled }) },
  ] });
  return { socket, negotiate, deliver: (data: ArrayBuffer) => request.bulkEvents.onmessage(data) };
}

function batch(records: Uint8Array[], sequence = 1) {
  const bytes = new Uint8Array(9 + records.reduce((sum, record) => sum + 4 + record.length, 0));
  bytes.set([67, 71, 82, 49]); bytes[8] = records.length;
  const view = new DataView(bytes.buffer); view.setUint32(4, sequence);
  let offset = 9;
  for (const record of records) {
    view.setUint32(offset, record.length); offset += 4;
    bytes.set(record, offset); offset += record.length;
  }
  return bytes.buffer;
}

function encrypted() {
  const context = { transferId: crypto.randomUUID(), epoch: crypto.randomUUID(), manifestId: 'a'.repeat(64),
    sessionId: 'session', desktopKey: 'host', clientKey: 'viewer' };
  const secret = new Uint8Array(32).fill(7);
  const sender = new BulkCipher(secret, { ...context, desktop: true });
  const receiver = new BulkCipher(secret, { ...context, desktop: false });
  const payload = new Uint8Array(12 * 1024).map((_, index) => index % 251);
  const record = sender.encrypt({ requestId: crypto.randomUUID(), block: 0, offset: 0 }, payload);
  return { context, payload, receiver, sender, record, wire: encodeBulkRelay('session', record) };
}

it('selects bulk on a relay-only PC connection and preserves encrypted bytes through raw IPC', async () => {
  const { socket, negotiate, deliver } = await connect();
  const bulk = new BulkTransport({ available: () => socket.bulkAvailable, send: vi.fn() });
  bulk.setMode('relay');
  const client = downloadBulkClient({ peer: () => 'pc', link: () => ({ bulk }) as ChatLink,
    supported: () => true, request: vi.fn() });
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileBulkEnabled: 1 });
  expect(client.available()).toBe(false);
  negotiate(true);
  expect(client.available()).toBe(true); expect(client.path()).toBe('relay');
  const fixture = encrypted(), received: Uint8Array[] = [];
  bulk.listen(fixture.context.transferId, { epoch: fixture.context.epoch, path: 'relay', failed: vi.fn(),
    record: bytes => { received.push(fixture.receiver.decrypt(bytes).bytes); } });
  socket.onbulk = (session, bytes) => { expect(session).toBe('session'); bulk.receive(bytes, 'relay'); };
  deliver(batch([fixture.wire]));
  expect(received).toEqual([fixture.payload]);
  expect(invoke).toHaveBeenCalledWith('gui_remote_ack', {
    request: { clientId: socket.clientId, sequence: 1, bulk: true },
  });
  socket.close(); deliver(batch([fixture.wire], 2));
  expect(received).toHaveLength(1); expect(client.available()).toBe(false);
  bulk.close(); fixture.sender.destroy(); fixture.receiver.destroy();
});

it('keeps older coordinators in compatibility mode and rejects unnegotiated binary data', async () => {
  const { socket, negotiate, deliver } = await connect();
  negotiate(false);
  expect(socket.bulkAvailable).toBe(false);
  const fixture = encrypted();
  socket.onbulk = vi.fn(); deliver(batch([fixture.wire]));
  expect(socket.onbulk).not.toHaveBeenCalled(); expect(socket.readyState).toBe(3);
  fixture.sender.destroy(); fixture.receiver.destroy();
});

it('validates every record before delivering any part of a malformed batch', async () => {
  const { socket, negotiate, deliver } = await connect();
  negotiate(true); socket.onbulk = vi.fn();
  const fixture = encrypted();
  const malformed = batch([fixture.wire, fixture.wire]).slice(0, -1);
  expect(() => decodeGuiBulkBatch(malformed)).toThrow();
  deliver(malformed);
  expect(socket.onbulk).not.toHaveBeenCalled(); expect(socket.readyState).toBe(3);
  fixture.sender.destroy(); fixture.receiver.destroy();
});

it('fails the socket if the native batch acknowledgement cannot be delivered', async () => {
  const { socket, negotiate, deliver } = await connect();
  negotiate(true);
  const fixture = encrypted();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('closed native worker'));
  deliver(batch([fixture.wire])); await flush();
  expect(socket.readyState).toBe(3); expect(socket.bulkAvailable).toBe(false);
  fixture.sender.destroy(); fixture.receiver.destroy();
});
