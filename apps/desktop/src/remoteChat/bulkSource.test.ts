import { afterEach, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { BulkSource } from './bulkSource';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { BulkTransport } from '../../../../shared/remote-chat/bulkTransport';
import { bulkCapability } from '../../../../shared/remote-chat/bulkControl';
import { manifestHasher } from '../../../../shared/remote-chat/downloadManifest';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import { bulkScheduler } from '../../../../shared/remote-chat/bulkScheduler';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: mocks.request } }));
vi.mock('../api/backend', () => ({ isDesktopApp: true }));
vi.mock('../../../../shared/remote-chat/policy', () => ({
  getChatPolicy: () => ({ fileBulkEnabled: 1 }), fileDownloadByteLimit: () => 10 * 1024 * 1024,
}));

const sources: BulkSource[] = [];
afterEach(() => { sources.splice(0).forEach(source => source.close()); vi.clearAllMocks(); });

function fixture() {
  const bytes = new Uint8Array(50_000).fill(59);
  const dimensions = { size: bytes.length, blockSize: 1024 * 1024, blockCount: 1 };
  const hash = sha256(bytes);
  const manifest = { ...dimensions, version: 1 as const, algorithm: 'sha256' as const,
    manifestId: bytesToHex(manifestHasher(dimensions).update(hash).update(hash).digest()),
    fileHash: bytesToHex(hash), sourceVersion: 'source' };
  mocks.request.mockImplementation(async request => request.operation === 'fileManifest' ? manifest : undefined);
  mocks.invoke.mockImplementation(async () => bytes.slice().buffer);
  const transferId = crypto.randomUUID(), epoch = crypto.randomUUID(), id = crypto.randomUUID();
  const context = { transferId, epoch, manifestId: manifest.manifestId,
    desktopKey: 'host', clientKey: 'viewer', sessionId: 'authenticated-session' };
  const root = new Uint8Array(32).fill(8);
  const receiver = new BulkCipher(root, { ...context, desktop: false });
  const records: Uint8Array[] = [];
  const transport = new BulkTransport();
  transport.attach({ readyState: 'open', bufferedAmount: 0, maxRecordBytes: 1024,
    send: record => { records.push(receiver.decrypt(record).bytes); }, close() {}, onMessage() {},
    onLow: () => () => undefined, onClose() {} });
  transport.setMode('direct');
  const link = { bulk: transport, connectionMode: 'direct', send: vi.fn(async () => undefined),
    createBulkCipher: () => new BulkCipher(root, { ...context, desktop: true }) };
  const source = new BulkSource(link as unknown as ChatLink, 'peer'); sources.push(source);
  const control = (body: object) => source.execute({ kind: 'request', id: crypto.randomUUID(), method: 'request', body });
  return { source, link, transport, records, bytes, manifest, control, epoch, transferId,
    open: { action: 'open', transferId, epoch, id, path: 'direct', capability: bulkCapability('idb-atomic', 1024) } };
}

it('reads verified binary IPC blocks, respects negotiated complete record size and deduplicates requests', async () => {
  const test = fixture();
  expect((await test.control(test.open)).error).toBeUndefined();
  const request = { action: 'request', transferId: test.transferId, epoch: test.epoch,
    manifestId: test.manifest.manifestId, requestId: crypto.randomUUID(), requestNumber: 1, block: 0,
    granted: test.bytes.length };
  expect((await test.control(request)).error).toBeUndefined();
  expect((await test.control(request)).error).toBeUndefined();
  await vi.waitFor(() => expect(test.records.reduce((sum, bytes) => sum + bytes.length, 0)).toBe(test.bytes.length));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(test.records.every(bytes => bytes.length <= 1024 - 88)).toBe(true);
  const joined = new Uint8Array(test.bytes.length); let offset = 0;
  test.records.forEach(bytes => { joined.set(bytes, offset); offset += bytes.length; });
  expect(joined).toEqual(test.bytes);
  test.source.close();
  await vi.waitFor(() => expect(bulkScheduler.usage.memoryBytes).toBe(0));
});

it('fences source reads and releases the global file slot when a path changes', async () => {
  const test = fixture(); await test.control(test.open);
  test.transport.setMode('relay');
  const response = await test.control({ action: 'request', transferId: test.transferId, epoch: test.epoch });
  expect(response.error).toBe('EPOCH_EXPIRED');
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'fileClose' }));
});

it('reports SOURCE_CHANGED and stops the transfer without sending payload bytes', async () => {
  const test = fixture(); await test.control(test.open);
  mocks.invoke.mockRejectedValue('SOURCE_CHANGED');
  await test.control({ action: 'request', transferId: test.transferId, epoch: test.epoch,
    manifestId: test.manifest.manifestId, requestId: crypto.randomUUID(), requestNumber: 1,
    block: 0, granted: test.bytes.length });
  await vi.waitFor(() => expect(test.link.send).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'event', event: expect.objectContaining({ params: expect.objectContaining({ code: 'SOURCE_CHANGED' }) }),
  })));
  expect(test.records).toHaveLength(0);
});

it('deduplicates OPEN but rejects a cancelled epoch instead of resetting its nonce counter', async () => {
  const test = fixture();
  expect((await test.control(test.open)).error).toBeUndefined();
  expect((await test.control(test.open)).error).toBeUndefined();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await test.control({ action: 'cancel', transferId: test.transferId, epoch: test.epoch });
  expect((await test.control(test.open)).error).toBe('REPLAY');
  expect((await test.control({ ...test.open, epoch: crypto.randomUUID() })).error).toBeUndefined();
});

it('interleaves bounded batches from two files and releases their shared memory reservations', async () => {
  const first = fixture(), second = fixture();
  for (const test of [first, second]) {
    expect((await test.control(test.open)).error).toBeUndefined();
    expect((await test.control({ action: 'request', transferId: test.transferId, epoch: test.epoch,
      manifestId: test.manifest.manifestId, requestId: crypto.randomUUID(), requestNumber: 1,
      block: 0, granted: test.bytes.length })).error).toBeUndefined();
  }
  await vi.waitFor(() => {
    expect(first.records.length).toBeGreaterThan(0); expect(second.records.length).toBeGreaterThan(0);
  });
  for (const test of [first, second]) {
    await vi.waitFor(() => expect(test.records.reduce((sum, bytes) => sum + bytes.length, 0)).toBe(test.bytes.length));
    test.source.close();
  }
  await vi.waitFor(() => expect(bulkScheduler.usage.memoryBytes).toBe(0));
});
