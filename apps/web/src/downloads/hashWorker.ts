import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { decodeBulkRecord } from '../../../../shared/remote-chat/bulkProtocol';
import { bulkAssert, bulkError } from '../../../../shared/remote-chat/bulkLimits';

let hash = sha256.create();
let material: { key: Uint8Array; transferId: string; epoch: string } | undefined;
let sequence = 0;

self.onmessage = (event: MessageEvent<{ id: number; action: string; bytes?: Uint8Array;
  expected?: string; material?: typeof material }>) => {
  const { id, action, bytes, expected } = event.data;
  try {
    if (action === 'init') { material = event.data.material; self.postMessage({ id }); return; }
    if (action === 'decode') {
      bulkAssert(material && bytes, 'INVALID_RECORD');
      const { header, aad, encrypted } = decodeBulkRecord(bytes);
      bulkAssert(header.transferId === material.transferId && header.epoch === material.epoch, 'EPOCH_EXPIRED');
      bulkAssert(header.sequence > sequence, 'REPLAY');
      const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(8, header.sequence);
      const plain = chacha20poly1305(material.key, nonce, aad).decrypt(encrypted);
      sequence = header.sequence;
      self.postMessage({ id, header, bytes: plain }, { transfer: [plain.buffer] }); return;
    }
    if (action === 'verify') {
      bulkAssert(bytes && bytesToHex(sha256(bytes)) === expected, 'INTEGRITY_FAILED');
      self.postMessage({ id, bytes }, { transfer: [bytes.buffer] }); return;
    }
    if (action === 'update') { bulkAssert(bytes, 'INVALID_RECORD'); hash.update(bytes); }
    if (action === 'finish') {
      bulkAssert(bytesToHex(hash.digest()) === expected, 'INTEGRITY_FAILED'); hash = sha256.create();
    }
    self.postMessage({ id });
  } catch (error) { self.postMessage({ id, error: bulkError(error).code }); }
};
