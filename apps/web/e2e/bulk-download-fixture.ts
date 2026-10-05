import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { BulkCipher } from '../../../shared/remote-chat/bulkCipher';
import { BULK_PAYLOAD_BYTES } from '../../../shared/remote-chat/bulkProtocol';
import { BulkTransport, type BulkPath } from '../../../shared/remote-chat/bulkTransport';
import { BULK_LIMITS } from '../../../shared/remote-chat/bulkLimits';
import { manifestHasher, type DownloadManifest } from '../../../shared/remote-chat/downloadManifest';
import { bulkCapability, type BulkClient, type BulkRequest } from '../../../shared/remote-chat/bulkControl';

interface Fixture {
  size: number; revision: string; delay: number; corrupt: boolean; offsets: number[];
  bulk: boolean; recordBytes: number; wireBytes: number; cipherFailure: boolean;
}
interface Transfer {
  epoch: string; size: number; manifest: DownloadManifest; hashes: Uint8Array[];
  sender: BulkCipher; receiver: BulkCipher; value: number; path: BulkPath;
}

export function fixtureBulkClient(fixture: Fixture) {
  let current: BulkPath = 'direct';
  const transport = new BulkTransport({ available: () => true, send: async () => undefined });
  transport.attach({ readyState: 'open', bufferedAmount: 0, send() {}, close() {},
    onMessage() {}, onLow: () => () => undefined, onClose() {} });
  transport.setMode(current);
  const transfers = new Map<string, Transfer>();
  const contexts = { desktopKey: 'desktop', clientKey: 'client', sessionId: 'fixture' };
  const root = new Uint8Array(32).fill(17);
  let outgoing = Promise.resolve();

  async function send(request: BulkRequest) {
    const transfer = transfers.get(request.transferId);
    if (!transfer || transfer.epoch !== request.epoch) return;
    const offset = request.block * BULK_LIMITS.blockBytes;
    fixture.offsets.push(offset);
    await new Promise(resolve => setTimeout(resolve, fixture.delay));
    const bytes = new Uint8Array(Math.min(BULK_LIMITS.blockBytes, transfer.size - offset)).fill(transfer.value);
    if (fixture.corrupt && bytes.length) bytes[0] ^= 1;
    for (let part = 0; part < bytes.length; part += BULK_PAYLOAD_BYTES) {
      if (transfers.get(request.transferId) !== transfer) return;
      const record = transfer.sender.encrypt({ requestId: request.requestId, block: request.block, offset: part },
        bytes.subarray(part, part + BULK_PAYLOAD_BYTES));
      if (fixture.cipherFailure) record[record.length - 1] ^= 1;
      fixture.recordBytes = Math.max(fixture.recordBytes, record.length); fixture.wireBytes += record.length;
      transport.receive(record, transfer.path);
      if (part % (BULK_PAYLOAD_BYTES * 8) === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const client: BulkClient = {
    peer: 'fixture-pc', available: () => fixture.bulk, path: () => current, transport: () => transport,
    open: async open => {
      const size = open.id.startsWith('2222') ? 0 : fixture.size;
      const value = fixture.revision === 'first' ? 65 : 66;
      const hashes: Uint8Array[] = []; const whole = sha256.create();
      for (let offset = 0; offset < size; offset += BULK_LIMITS.blockBytes) {
        const bytes = new Uint8Array(Math.min(BULK_LIMITS.blockBytes, size - offset)).fill(value);
        hashes.push(sha256(bytes)); whole.update(bytes);
      }
      const fileHash = whole.digest();
      const dimensions = { size, blockSize: BULK_LIMITS.blockBytes, blockCount: hashes.length };
      const digest = manifestHasher(dimensions); hashes.forEach(hash => digest.update(hash));
      const manifest: DownloadManifest = { ...dimensions, version: 1, algorithm: 'sha256', sourceVersion: 'constant',
        manifestId: bytesToHex(digest.update(fileHash).digest()), fileHash: bytesToHex(fileHash) };
      const context = { ...contexts, transferId: open.transferId, manifestId: manifest.manifestId, epoch: open.epoch };
      const transfer = { epoch: open.epoch, size, manifest, hashes, value, path: open.path,
        sender: new BulkCipher(root, { ...context, desktop: true }),
        receiver: new BulkCipher(root, { ...context, desktop: false }) };
      transfers.set(open.transferId, transfer);
      return { transferId: open.transferId, epoch: open.epoch, path: open.path,
        capability: bulkCapability('synced-file'), manifest };
    },
    page: async (id, page) => {
      const transfer = transfers.get(id)!;
      return { manifestId: transfer.manifest.manifestId, page,
        totalPages: Math.ceil(transfer.hashes.length / BULK_LIMITS.hashesPerPage),
        hashes: transfer.hashes.slice(page * BULK_LIMITS.hashesPerPage, (page + 1) * BULK_LIMITS.hashesPerPage)
          .map(bytesToHex) };
    },
    request: async request => {
      outgoing = outgoing.then(() => send(request));
      void outgoing.catch(() => transport.invalidate());
    },
    cancel: async (id, epoch) => {
      const transfer = transfers.get(id);
      if (transfer?.epoch !== epoch) return;
      transfer.sender.destroy(); transfer.receiver.destroy(); transfers.delete(id);
    },
    cipher: context => transfers.get(context.transferId)!.receiver,
  };
  return { client, path: (path: BulkPath) => { current = path; transport.setMode(path); } };
}
