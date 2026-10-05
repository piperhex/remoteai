import { afterEach, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { BulkSource } from './bulkSource';
import { NativeChatTransport, type HostTransportEvent } from './nativeTransport';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { BulkTransport } from '../../../../shared/remote-chat/bulkTransport';
import { decodeBulkRelay } from '../../../../shared/remote-chat/bulkRelayWire';
import { bulkCapability } from '../../../../shared/remote-chat/bulkControl';
import { BULK_LIMITS } from '../../../../shared/remote-chat/bulkLimits';
import { manifestHasher } from '../../../../shared/remote-chat/downloadManifest';
import { bulkScheduler } from '../../../../shared/remote-chat/bulkScheduler';
import type { ChatLink } from '../../../../shared/remote-chat/link';

type Batch = { sequence: number; events: HostTransportEvent[] };
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), receive: (_batch: Batch) => {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class {
  set onmessage(callback: (batch: Batch) => void) { mocks.receive = callback; }
} }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: mocks.request } }));
vi.mock('../api/backend', () => ({ isDesktopApp: true }));
vi.mock('../../../../shared/remote-chat/policy', () => ({
  getChatPolicy: () => ({ fileBulkEnabled: 1 }), fileDownloadByteLimit: () => 300 * 1024 * 1024,
}));

const cleanup: (() => void)[] = [];
afterEach(async () => { cleanup.splice(0).forEach(close => close()); await Promise.resolve(); vi.clearAllMocks(); });

function content(block: number) { return new Uint8Array(BULK_LIMITS.blockBytes).fill(block % 251); }
function manifest(blockCount: number) {
  const dimensions = { size: blockCount * BULK_LIMITS.blockBytes, blockSize: BULK_LIMITS.blockBytes, blockCount };
  const whole = sha256.create(), identity = manifestHasher(dimensions);
  for (let block = 0; block < blockCount; block++) {
    const bytes = content(block); whole.update(bytes); identity.update(sha256(bytes));
  }
  const fileHash = whole.digest();
  return { ...dimensions, version: 1 as const, algorithm: 'sha256' as const, sourceVersion: 'fixture',
    fileHash: bytesToHex(fileHash), manifestId: bytesToHex(identity.update(fileHash).digest()) };
}

it('sends 32 MiB through bounded raw IPC batches with ordered ciphertext and room for control callbacks', async () => {
  const info = manifest(32), received = sha256.create();
  const context = { transferId: crypto.randomUUID(), epoch: crypto.randomUUID(), manifestId: info.manifestId,
    desktopKey: 'desktop', clientKey: 'mobile', sessionId: 'phone' };
  const root = new Uint8Array(32).fill(11);
  const cipher = new BulkCipher(root, { ...context, desktop: false });
  let ipcCalls = 0, receivedBytes = 0, controlTicks = 0, maxBatch = 0;
  const offsets = new Map<number, number>();
  const blocks = new Map<number, () => void>();
  const readBatch = (bytes: Uint8Array) => {
    expect(Array.from(bytes.subarray(0, 4))).toEqual([67, 83, 70, 66]);
    maxBatch = Math.max(maxBatch, bytes[4]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 5;
    for (let index = 0; index < bytes[4]; index++) {
      const length = view.getUint32(offset); offset += 4;
      const wire = decodeBulkRelay(bytes.slice(offset, offset + length).buffer); offset += length;
      expect(wire.sessionId).toBe('phone');
      const decoded = cipher.decrypt(wire.record);
      expect(decoded.header.offset).toBe(offsets.get(decoded.header.block) ?? 0);
      offsets.set(decoded.header.block, decoded.header.offset + decoded.bytes.length);
      received.update(decoded.bytes); receivedBytes += decoded.bytes.length;
      if (offsets.get(decoded.header.block) === BULK_LIMITS.blockBytes) blocks.get(decoded.header.block)?.();
    }
    expect(offset).toBe(bytes.length);
  };
  mocks.request.mockImplementation(async request => request.operation === 'fileManifest' ? info : undefined);
  mocks.invoke.mockImplementation(async (command: string, data: Uint8Array | { request: { block: number } }) => {
    if (command === 'codex_gui_file_bulk_read' && !(data instanceof Uint8Array)) return content(data.request.block).buffer;
    if (command !== 'remote_chat_bulk_send' || !(data instanceof Uint8Array)) return;
    ipcCalls++;
    // Model the native socket's idle read wait once per command, as on a quiet relay connection.
    await new Promise(resolve => setTimeout(resolve, 20)); readBatch(data);
  });
  const native = new NativeChatTransport(() => {}); cleanup.push(() => native.close());
  await Promise.resolve(); await Promise.resolve();
  mocks.receive({ sequence: 1, events: [{ type: 'ready', generation: 1 }] });
  const transport = new BulkTransport({ available: () => native.ready,
    send: record => native.sendBulk('phone', [record]), sendBatch: records => native.sendBulk('phone', records) });
  transport.setMode('relay');
  const source = new BulkSource({ bulk: transport, connectionMode: 'relay', send: vi.fn(async () => {}),
    createBulkCipher: () => new BulkCipher(root, { ...context, desktop: true }) } as unknown as ChatLink, 'peer');
  cleanup.push(() => source.close());
  const control = (body: object) => source.execute({ kind: 'request', id: crypto.randomUUID(), method: 'request', body });
  expect((await control({ action: 'open', ...context, id: crypto.randomUUID(), path: 'relay',
    capability: bulkCapability('synced-file') })).error).toBeUndefined();
  const timer = setInterval(() => { controlTicks++; }, 5); cleanup.push(() => clearInterval(timer));
  const started = performance.now();
  for (let block = 0; block < info.blockCount; block++) {
    const finished = new Promise<void>(resolve => { blocks.set(block, resolve); });
    expect((await control({ action: 'request', ...context, block, requestId: crypto.randomUUID(),
      requestNumber: block + 1, granted: (block + 1) * BULK_LIMITS.blockBytes })).error).toBeUndefined();
    await finished;
  }
  const seconds = (performance.now() - started) / 1000;
  expect(bytesToHex(received.digest())).toBe(info.fileHash);
  expect(receivedBytes).toBe(info.size);
  expect(maxBatch).toBe(BULK_LIMITS.sendBatchRecords);
  expect(ipcCalls).toBe(32 * 5);
  expect(controlTicks).toBeGreaterThan(32);
  source.close();
  await vi.waitFor(() => expect(bulkScheduler.usage.memoryBytes).toBe(0));
  expect(native.bufferedAmount).toBe(0);
  console.info(`32 MiB controlled relay: ${seconds.toFixed(2)} s, ${(32 / seconds).toFixed(2)} MiB/s, ${ipcCalls} IPC waits`);
}, 30_000);
