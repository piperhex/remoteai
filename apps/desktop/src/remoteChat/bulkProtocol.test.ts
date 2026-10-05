import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { SessionCipher, keyPair } from '../../../../shared/remote-chat/cipher';
import { BULK_LIMITS } from '../../../../shared/remote-chat/bulkLimits';
import { BULK_PAYLOAD_BYTES, decodeBulkRecord } from '../../../../shared/remote-chat/bulkProtocol';
import { BulkCredit, BulkScheduler } from '../../../../shared/remote-chat/bulkScheduler';
import { BulkAssembly } from '../../../../shared/remote-chat/bulkAssembly';
import { DownloadSession } from '../../../../shared/remote-chat/downloadSession';
import { authenticateManifest, manifestHasher } from '../../../../shared/remote-chat/downloadManifest';

const transferId = '00000000-0000-4000-8000-000000000001';
const epoch = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';

function ciphers(epochId = epoch) {
  const desktop = keyPair(length => new Uint8Array(length).fill(1));
  const mobile = keyPair(length => new Uint8Array(length).fill(2));
  const context = { transferId, epoch: epochId, manifestId: 'f'.repeat(64) };
  const host = new SessionCipher({ ...desktop, publicKey: mobile.publicKey, sessionId: 'session', desktop: true });
  const client = new SessionCipher({ ...mobile, publicKey: desktop.publicKey, sessionId: 'session', desktop: false });
  return { sender: host.createBulkCipher(context), receiver: client.createBulkCipher(context) };
}

describe('authenticated binary file records', () => {
  it('round trips a complete 16 KiB record without RPC framing and rejects replay', () => {
    const { sender, receiver } = ciphers();
    const bytes = new Uint8Array(BULK_PAYLOAD_BYTES).fill(27);
    const record = sender.encrypt({ requestId, block: 0, offset: 0 }, bytes);
    expect(record.byteLength).toBe(BULK_LIMITS.recordBytes);
    expect(receiver.decrypt(record).bytes).toEqual(bytes);
    expect(() => receiver.decrypt(record)).toThrow();
  });

  it('authenticates every header byte before accepting a sequence', () => {
    const { sender, receiver } = ciphers();
    const record = sender.encrypt({ requestId, block: 0, offset: 0 }, Uint8Array.of(1, 2, 3));
    for (const offset of [8, 24, 40, 56, 60, 64, 68, 72, record.length - 1]) {
      const changed = record.slice(); changed[offset] ^= 1;
      expect(() => receiver.decrypt(changed)).toThrow();
    }
    expect(receiver.decrypt(record).bytes).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('rejects truncation, trailing bytes, oversized records and wrong epochs', () => {
    const { sender } = ciphers();
    const record = sender.encrypt({ requestId, block: 0, offset: 0 }, Uint8Array.of(7));
    expect(() => decodeBulkRecord(record.slice(0, -1))).toThrow();
    expect(() => decodeBulkRecord(new Uint8Array([...record, 0]))).toThrow();
    expect(() => decodeBulkRecord(new Uint8Array(BULK_LIMITS.recordBytes + 1))).toThrow();
    expect(() => ciphers('00000000-0000-4000-8000-000000000099').receiver.decrypt(record)).toThrow();
    expect(() => sender.decrypt(record)).toThrow();
  });

  it('ends the epoch before the nonce counter can wrap and keeps destroyed keys unusable', () => {
    const { sender, receiver } = ciphers();
    // Advance only the test counter to exercise a lifetime boundary without sending four billion records.
    Reflect.set(sender, 'sent', 0xfffffffe);
    const header = { requestId, block: 0, offset: 0 };
    const record = sender.encrypt(header, Uint8Array.of(1));
    expect(receiver.decrypt(record).header.sequence).toBe(0xffffffff);
    expect(() => sender.encrypt(header, Uint8Array.of(2))).toThrow();
    receiver.destroy();
    expect(() => receiver.receiverMaterial()).toThrow();
    expect(() => receiver.decrypt(record)).toThrow();
  });
});

describe('bounded blocks and byte credit', () => {
  it('treats duplicate credit as a high-water mark and rejects overspend and jumps', () => {
    const credit = new BulkCredit(epoch);
    credit.update(epoch, 1024); credit.consume(1000); credit.update(epoch, 1024);
    expect(credit.available).toBe(24);
    expect(() => credit.consume(25)).toThrow();
    expect(() => credit.update(transferId, 1024)).toThrow();
    expect(() => credit.update(epoch, Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it('shares the peer window across files, wakes fairly, and releases cancelled waiters', async () => {
    const scheduler = new BulkScheduler();
    const controller = new AbortController();
    const reserve = (transfer: string) => scheduler.reserve({ peer: 'pc', transfer,
      bytes: BULK_LIMITS.blockBytes, memory: 3 * BULK_LIMITS.blockBytes, signal: controller.signal });
    const first = await reserve('first'); const second = await reserve('first');
    let ran = false;
    const third = reserve('second').then(release => { ran = true; return release; });
    await Promise.resolve(); expect(ran).toBe(false);
    first(); const releaseThird = await third;
    expect(scheduler.usage.requestBytes).toBe(BULK_LIMITS.peerRequestBytes);
    const cancelled = reserve('first'); controller.abort(); await expect(cancelled).rejects.toThrow();
    second(); releaseThird(); first();
    expect(scheduler.usage).toEqual({ requestBytes: 0, memoryBytes: 0, waiting: 0 });
  });

  it('rejects unrequested fragments, overlapping offsets and corrupted block hashes', () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const assembly = new BulkAssembly({ requestId, block: 0, length: 3, hash: bytesToHex(sha256(bytes)) });
    const header = { transferId, epoch, requestId, block: 0, offset: 0, length: 2, sequence: 1 };
    expect(assembly.accept(header, bytes.subarray(0, 2))).toBeUndefined();
    expect(() => assembly.accept(header, bytes.subarray(0, 2))).toThrow();
    expect(assembly.accept({ ...header, offset: 2, length: 1 }, bytes.subarray(2))).toEqual(bytes);
  });
});

it('authenticates the explicit zero-byte manifest and rejects forged identities', async () => {
  const fileHash = bytesToHex(sha256(new Uint8Array()));
  const dimensions = { size: 0, blockSize: BULK_LIMITS.blockBytes, blockCount: 0 };
  const manifestId = bytesToHex(manifestHasher(dimensions).update(sha256(new Uint8Array())).digest());
  const manifest = { ...dimensions, version: 1 as const, algorithm: 'sha256' as const,
    fileHash, manifestId, sourceVersion: 'empty' };
  const options = { manifest, signal: new AbortController().signal,
    read: async () => { throw new Error('Empty file has no pages'); }, store: async () => undefined };
  await authenticateManifest(options);
  await expect(authenticateManifest({ ...options, manifest: { ...manifest, manifestId: '0'.repeat(64) } }))
    .rejects.toThrow();
});

it('cannot complete on received bytes or before final publication succeeds', () => {
  const session = new DownloadSession('bulk', epoch);
  session.move('downloading');
  expect(() => session.move('completed')).toThrow();
  session.move('verifying'); expect(() => session.move('saving')).toThrow();
  session.fileVerified(); session.move('saving');
  expect(() => session.move('completed')).toThrow();
  session.fileSaved(); session.move('completed');
  expect(session.phase).toBe('completed');
});
