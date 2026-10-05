import { x25519 } from '@noble/curves/ed25519';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { decodeChatUtf8 } from './utf8';
import type { PacketCipher, PacketCipherFactory } from './packetCipher';
import { BulkCipher, type BulkCipherContext } from './bulkCipher';

const REPLAY_WINDOW = 1024;

export function keyPair(random: (length: number) => Uint8Array) {
  const secret = random(32);
  return { secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) };
}

/** Separate nonce namespaces per direction; authenticated session binding and replay rejection. */
export class SessionCipher {
  private readonly key: Uint8Array;
  private readonly bulkKey: Uint8Array;
  private readonly bulkIdentity: Pick<BulkCipherContext, 'sessionId' | 'desktopKey' | 'clientKey' | 'desktop'>;
  private readonly context: Uint8Array;
  private readonly packetCipher?: PacketCipher;
  private destroyed = false;
  private sequence = 0;
  private highestReceived = 0;
  private readonly received = new Uint32Array(REPLAY_WINDOW);
  private readonly bulkEpochs = new Set<string>();

  constructor(options: {
    secret: Uint8Array; publicKey: string; sessionId: string; desktop: boolean;
    createPacketCipher?: PacketCipherFactory;
  }) {
    const shared = x25519.getSharedSecret(options.secret, hexToBytes(options.publicKey));
    this.context = utf8ToBytes(`codex-switch-chat-v1:${options.sessionId}`);
    this.key = hkdf(sha256, shared, this.context, 'chat encryption', 32);
    this.bulkKey = hkdf(sha256, this.key, this.context, 'file bulk root v1', 32);
    const localKey = bytesToHex(x25519.getPublicKey(options.secret));
    this.bulkIdentity = { sessionId: options.sessionId, desktop: options.desktop,
      desktopKey: options.desktop ? localKey : options.publicKey,
      clientKey: options.desktop ? options.publicKey : localKey };
    shared.fill(0);
    this.direction = options.desktop ? 1 : 2;
    try {
      this.packetCipher = options.createPacketCipher?.({ key: this.key, context: this.context });
    } catch (error) { this.key.fill(0); this.bulkKey.fill(0); throw error; }
    if (this.packetCipher) this.key.fill(0);
  }

  private readonly direction: number;

  createBulkCipher(context: Pick<BulkCipherContext, 'transferId' | 'manifestId' | 'epoch'>) {
    if (this.destroyed) throw new Error('Session closed');
    if (this.bulkEpochs.has(context.epoch) || this.bulkEpochs.size >= 1024) throw new Error('File epoch already used');
    this.bulkEpochs.add(context.epoch);
    return new BulkCipher(this.bulkKey, { ...this.bulkIdentity, ...context });
  }

  encrypt(text: string) {
    if (this.destroyed) throw new Error('Session closed');
    this.sequence += 1;
    if (this.sequence > 0xffffffff) throw new Error('请重新连接电脑。');
    const nonce = new Uint8Array(12);
    const view = new DataView(nonce.buffer);
    view.setUint32(0, this.direction);
    view.setUint32(8, this.sequence);
    if (this.packetCipher) return this.packetCipher.encrypt(text, bytesToHex(nonce));
    const encrypted = chacha20poly1305(this.key, nonce, this.context).encrypt(utf8ToBytes(text));
    return bytesToHex(nonce) + bytesToHex(encrypted);
  }

  decrypt(payload: string): string | null {
    if (this.destroyed) throw new Error('Session closed');
    if (payload.length > 40_000 || payload.length < 56 || payload.length % 2 !== 0) throw new Error('Invalid packet');
    // Native codecs validate and decode the ciphertext. Hermes only needs the fixed-size nonce for replay checks.
    const encoded = this.packetCipher ? payload.slice(0, 24) : payload;
    if (!/^[a-f0-9]+$/.test(encoded)) throw new Error('Invalid packet');
    const bytes = hexToBytes(encoded);
    const nonce = bytes.subarray(0, 12);
    const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
    const sequence = view.getUint32(8);
    if (view.getUint32(0) !== (this.direction === 1 ? 2 : 1) || view.getUint32(4) !== 0 || sequence === 0) {
      throw new Error('Invalid nonce');
    }
    const slot = sequence % REPLAY_WINDOW;
    if (this.received[slot] === sequence || sequence <= this.highestReceived - REPLAY_WINDOW) return null;
    const plain = this.packetCipher ? this.packetCipher.decrypt(payload)
      : decodeChatUtf8(chacha20poly1305(this.key, nonce, this.context).decrypt(bytes.subarray(12)));
    // Only authenticated packets enter the ring. Sequences sharing a slot cannot both be inside the replay window.
    this.received[slot] = sequence;
    this.highestReceived = Math.max(this.highestReceived, sequence);
    return plain;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.key.fill(0);
    this.bulkKey.fill(0);
    this.received.fill(0);
    this.bulkEpochs.clear();
    this.packetCipher?.destroy();
  }
}
