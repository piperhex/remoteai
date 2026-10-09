import { afterEach, expect, it, vi } from 'vitest';
import { BulkTransport, type BinaryChannel } from '../../../../shared/remote-chat/bulkTransport';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { HotPeer } from '../../../../shared/remote-chat/hotPeer';
import { NativePath, type NativePathEvent } from '../../../../shared/remote-chat/nativePath';
import { decodeNativeBulkBatch, encodeNativeBulkBatch, NativeBulkChannel }
  from '../../../../shared/remote-chat/nativeBulkChannel';
import { downloadBulkClient } from '../../../../shared/remote-chat/client/bulkClient';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../shared/remote-chat/policy';
import type { ChatLink } from '../../../../shared/remote-chat/link';

afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.useRealTimers(); });
const config = { secret: 'ab'.repeat(32), servers: ['udp://peer.example:11010'],
  stunServers: [], expiresAt: 100_000 };

function record() {
  const cipher = new BulkCipher(new Uint8Array(32).fill(9), { transferId: crypto.randomUUID(),
    epoch: crypto.randomUUID(), manifestId: 'c'.repeat(64), sessionId: 'session',
    desktopKey: 'host', clientKey: 'viewer', desktop: true });
  const bytes = cipher.encrypt({ requestId: crypto.randomUUID(), block: 0, offset: 0 }, Uint8Array.of(1, 2, 3));
  cipher.destroy(); return bytes;
}

function connectingRtc(): BinaryChannel {
  return { readyState: 'connecting', bufferedAmount: 0, send: vi.fn(), close: vi.fn(),
    onMessage() {}, onClose() {}, onLow: () => () => {} };
}

it('offers bulk on native-only P2P even when every RTC attempt is still connecting', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileBulkEnabled: 1 });
  const bulk = new BulkTransport(); bulk.setMode('direct');
  const download = downloadBulkClient({ link: () => ({ bulk }) as ChatLink, supported: () => true,
    peer: () => 'pc', request: vi.fn() });
  const bulkSend = vi.fn(async () => {}), close = vi.fn(async () => {});
  let receive!: (event: NativePathEvent) => void;
  const peer = new HotPeer({ sessionId: 'session', desktop: false, iceServers: [], nativeTraversal: config,
    bulkChannel: (channel, source) => bulk.attach(channel, source),
    createNativePath: options => new NativePath(options, {
      open: async (_input, callback) => { receive = callback; return 'handle'; },
      send: async () => {}, bulkSend, close,
    }),
    createPeer: options => {
      options.bulkChannel?.(connectingRtc());
      return { offer: async () => {}, accept: async () => {}, close() {} };
    }, channel: vi.fn(), signal: vi.fn(), disconnected: vi.fn(),
  });
  expect(download.available()).toBe(false);
  receive({ type: 'open' }); receive({ type: 'bulk', generation: 1 });
  expect(download.available()).toBe(true); expect(download.path()).toBe('direct');
  const bytes = record(), invalidated = vi.fn(); bulk.onInvalidated(invalidated);
  await bulk.sendBatch([bytes, bytes], 'direct', new AbortController().signal);
  expect(bulkSend).toHaveBeenCalledWith('handle', 1, [bytes, bytes]);
  for (const now of [60_000, 110_000, 160_000]) { vi.setSystemTime(now); peer.recover(false, true); }
  expect(download.available()).toBe(true); expect(invalidated).not.toHaveBeenCalled();
  receive({ type: 'bulk', generation: 0 });
  expect(download.available()).toBe(false); expect(invalidated).toHaveBeenCalledOnce();
  receive({ type: 'bulk', generation: 2 });
  await bulk.send(bytes, 'direct', new AbortController().signal);
  expect(bulkSend).toHaveBeenLastCalledWith('handle', 2, [bytes]);
  peer.close(); bulk.close(); await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
});

it('keeps older native modules in compatibility mode until a binary channel actually opens', () => {
  const bulk = new BulkTransport({ available: () => true, send: vi.fn() });
  bulk.setMode('direct'); bulk.attach(connectingRtc());
  expect(bulk.path).toBeUndefined();
  bulk.close();
});

it('keeps native IPC binary, bounded, and awaiting the native write acknowledgement', async () => {
  const bytes = record(); const batch = encodeNativeBulkBatch([bytes, bytes]);
  expect([...batch.subarray(0, 5)]).toEqual([82, 65, 78, 49, 2]);
  expect(new DataView(batch.buffer).getUint32(5)).toBe(bytes.length);
  expect(batch.subarray(9, 9 + bytes.length)).toEqual(bytes);
  expect(() => encodeNativeBulkBatch(Array.from({ length: 17 }, () => bytes))).toThrow();
  expect(() => encodeNativeBulkBatch([bytes, new Uint8Array(20)])).toThrow();
  let done!: () => void;
  const channel = new NativeBulkChannel(() => new Promise(resolve => { done = resolve; }));
  const sending = channel.sendBatch([bytes]);
  expect(channel.bufferedAmount).toBe(bytes.length);
  done(); await sending; expect(channel.bufferedAmount).toBe(0);
  channel.close(); await expect(channel.sendBatch([bytes])).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
});

it('reports native transport loss as resumable rather than a file integrity failure', async () => {
  const channel = new NativeBulkChannel(async () => { throw new Error('native handle closed'); });
  await expect(channel.sendBatch([record()])).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  expect(channel.bufferedAmount).toBe(0);
});

it('validates full receive batches and gives each worker record its own transferable buffer', () => {
  const first = record(), second = record();
  const batch = encodeNativeBulkBatch([first, second]);
  const records = decodeNativeBulkBatch(batch.buffer);
  expect(records).toEqual([first, second]);
  structuredClone(records[0], { transfer: [records[0].buffer] });
  expect(records[1]).toEqual(second);
  expect(decodeNativeBulkBatch(new ArrayBuffer(0))).toEqual([]);
  for (let length = 1; length < batch.length; length++) {
    expect(() => decodeNativeBulkBatch(batch.slice(0, length).buffer)).toThrow();
  }
  expect(() => decodeNativeBulkBatch(new Uint8Array([...batch, 0]).buffer)).toThrow();
  const oversized = batch.slice(); new DataView(oversized.buffer).setUint32(5, 0xffffffff);
  expect(() => decodeNativeBulkBatch(oversized.buffer)).toThrow();
});

it('keeps a single native receive loop through idle replies and binary stream replacement', async () => {
  let event!: (value: NativePathEvent) => void;
  let reply!: (records: Uint8Array[]) => void;
  const bulkReceive = vi.fn(() => new Promise<Uint8Array[]>(resolve => { reply = resolve; }));
  const channels: NativeBulkChannel[] = [];
  const path = new NativePath({ sessionId: 'session', desktop: false, config,
    bulkChannel: channel => channels.push(channel as NativeBulkChannel) }, {
    open: async (_options, callback) => { event = callback; return 'handle'; },
    bulkReceive, send: async () => {}, close: async () => {},
  });
  event({ type: 'open' }); event({ type: 'bulk', generation: 1 });
  await Promise.resolve();
  reply([]); await Promise.resolve();
  expect(bulkReceive).toHaveBeenCalledTimes(2);
  const old = vi.fn(), current = vi.fn(); channels[0].onMessage(old);
  event({ type: 'bulk', generation: 0 }); event({ type: 'bulk', generation: 2 });
  channels[1].onMessage(current);
  expect(bulkReceive).toHaveBeenCalledTimes(2);
  const bytes = record(); reply([bytes]); await Promise.resolve();
  expect(old).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledWith(bytes);
  expect(bulkReceive).toHaveBeenCalledTimes(3);
  path.close(); reply([bytes]); await Promise.resolve();
  expect(current).toHaveBeenCalledOnce(); expect(bulkReceive).toHaveBeenCalledTimes(3);
});
