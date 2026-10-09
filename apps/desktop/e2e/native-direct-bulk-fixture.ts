import { mockIPC } from '@tauri-apps/api/mocks';
import type { Channel } from '@tauri-apps/api/core';
import { createDesktopNativePath } from '../src/remoteChat/nativePath';
import { fixtureBulkClient } from '../../web/e2e/bulk-download-fixture';
import { BulkTransport } from '../../../shared/remote-chat/bulkTransport';
import { encodeNativeBulkBatch } from '../../../shared/remote-chat/nativeBulkChannel';
import type { NativePathEvent } from '../../../shared/remote-chat/nativePath';

export const NATIVE_DIRECT_FILE_BYTES = 32 * 1024 * 1024;
export const nativeDirectStats = { batches: 0, records: 0, activeReads: 0, maxReads: 0, polls: 0 };

/** Exercise the production native adapter and receiver, including the raw IPC decode before the Worker. */
export function nativeDirectBulkFixture() {
  const source = fixtureBulkClient({ size: NATIVE_DIRECT_FILE_BYTES, revision: 'first', delay: 150, corrupt: false,
    offsets: [], bulk: true, recordBytes: 0, wireBytes: 0, cipherFailure: false });
  const queued: Uint8Array[] = [];
  let pending: (() => void) | undefined;
  const transport = new BulkTransport(); transport.setMode('direct');
  source.client.transport()!.receive = bytes => { queued.push(bytes); queueMicrotask(() => pending?.()); };
  source.client.transport = () => transport;
  source.client.available = () => transport.path === 'direct';
  const read = () => new Promise<ArrayBuffer>(resolve => {
    nativeDirectStats.activeReads++;
    nativeDirectStats.maxReads = Math.max(nativeDirectStats.maxReads, nativeDirectStats.activeReads);
    const finish = () => {
      clearTimeout(timer); pending = undefined; nativeDirectStats.activeReads--;
      const records = queued.splice(0, 16);
      if (records.length) { nativeDirectStats.batches++; nativeDirectStats.records += records.length; }
      resolve(records.length ? encodeNativeBulkBatch(records).buffer : new ArrayBuffer(0));
    };
    const timer = window.setTimeout(finish, 250);
    pending = finish;
    if (queued.length) finish();
  });
  mockIPC((command, input) => {
    if (command === 'remote_native_bulk_receive') return read();
    if (command !== 'remote_native_path_open') return;
    const { events } = input as { events: Channel<NativePathEvent> };
    queueMicrotask(() => {
      events.onmessage({ type: 'open' }); events.onmessage({ type: 'bulk', generation: 1 });
    });
    return '11111111-1111-4111-8111-111111111111';
  });
  const path = createDesktopNativePath({ sessionId: 'fixture', desktop: false,
    config: { secret: 'ab'.repeat(32), servers: [], stunServers: [], expiresAt: Date.now() + 60_000 },
    bulkChannel: (channel, kind) => transport.attach(channel, kind) });
  window.addEventListener('pagehide', () => path.close(), { once: true });
  window.setInterval(() => { nativeDirectStats.polls++; }, 20);
  return source.client;
}
