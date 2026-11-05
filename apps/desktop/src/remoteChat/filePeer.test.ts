import { afterEach, expect, it, vi } from 'vitest';
import { FilePeer } from '../../../../shared/remote-chat/filePeer';
import { BulkTransport, type BinaryChannel } from '../../../../shared/remote-chat/bulkTransport';
import type { PeerOptions } from '../../../../shared/remote-chat/protocol';

afterEach(() => vi.useRealTimers());
it('retries an independently failed file data channel without involving the chat peer', () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const created: PeerOptions[] = [], closed: (() => void)[] = [];
  const transport = new BulkTransport(); transport.isolate();
  const controlClose = vi.fn();
  const peer = new FilePeer({ sessionId: 'session', desktop: false, secret: new Uint8Array(32),
    iceServers: [], createPeer: options => {
      created.push(options);
      const file: BinaryChannel = { readyState: 'open', bufferedAmount: 0, send() {}, close() {},
        onMessage() {}, onLow: () => () => {}, onClose: callback => closed.push(callback) };
      options.bulkChannel?.(file);
      options.channel({ readyState: 'open', bufferedAmount: 0, send() {}, close: controlClose,
        onOpen() {}, onMessage() {}, onClose() {} });
      return { offer: async () => {}, accept: async () => {}, close() {} };
    },
    signal: vi.fn(), relayBuffered: () => 0, message() {}, mode() {}, error() {},
  }, transport);
  closed.forEach(callback => callback());
  expect(controlClose).toHaveBeenCalledOnce();
  vi.setSystemTime(200_000); peer.tick(true);
  expect(created).toHaveLength(2); expect(created[1].generation).toBe(1);
  peer.close(); transport.close();
});
