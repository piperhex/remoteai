import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { bulkAssert } from './bulkLimits';
import { decodeBulkRecord, encodeBulkHeader, type BulkHeader } from './bulkProtocol';

export interface BulkCipherContext {
  transferId: string; manifestId: string; epoch: string; sessionId: string;
  desktopKey: string; clientKey: string; desktop: boolean;
}

/** Each authenticated transfer epoch has independent directional keys and nonce spaces. */
export class BulkCipher {
  private readonly sendKey: Uint8Array;
  private readonly receiveKey: Uint8Array;
  private sent = 0;
  private received = 0;
  private destroyed = false;

  constructor(root: Uint8Array, private readonly context: BulkCipherContext) {
    const binding = utf8ToBytes(JSON.stringify(['remote-ai:file-bulk:v1', context.sessionId,
      context.desktopKey, context.clientKey, context.transferId, context.manifestId, context.epoch]));
    const derive = (direction: string) => hkdf(sha256, root, binding, direction, 32);
    this.sendKey = derive(context.desktop ? 'desktop-to-client' : 'client-to-desktop');
    this.receiveKey = derive(context.desktop ? 'client-to-desktop' : 'desktop-to-client');
  }

  private nonce(sequence: number) {
    const nonce = new Uint8Array(12);
    new DataView(nonce.buffer).setUint32(8, sequence);
    return nonce;
  }

  encrypt(header: Omit<BulkHeader, 'sequence' | 'transferId' | 'epoch' | 'length'>, bytes: Uint8Array) {
    bulkAssert(!this.destroyed && this.sent < 0xffffffff, 'EPOCH_EXPIRED');
    const sequence = this.sent + 1;
    const aad = encodeBulkHeader({ ...header, transferId: this.context.transferId,
      epoch: this.context.epoch, length: bytes.length, sequence });
    this.sent = sequence;
    return concatBytes(aad, chacha20poly1305(this.sendKey, this.nonce(sequence), aad).encrypt(bytes));
  }

  decrypt(record: Uint8Array) {
    bulkAssert(!this.destroyed, 'EPOCH_EXPIRED');
    const { header, aad, encrypted } = decodeBulkRecord(record);
    bulkAssert(header.transferId === this.context.transferId && header.epoch === this.context.epoch, 'EPOCH_EXPIRED');
    bulkAssert(header.sequence > this.received, 'REPLAY');
    const bytes = chacha20poly1305(this.receiveKey, this.nonce(header.sequence), aad).decrypt(encrypted);
    this.received = header.sequence;
    return { header, bytes };
  }

  destroy() {
    this.destroyed = true;
    this.sendKey.fill(0); this.receiveKey.fill(0);
  }

  /** Hand a dedicated Worker only its receive key, never the session/root key. */
  receiverMaterial() {
    bulkAssert(!this.destroyed, 'EPOCH_EXPIRED');
    return { key: this.receiveKey.slice(), transferId: this.context.transferId, epoch: this.context.epoch };
  }
}
