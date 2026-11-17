import { invoke, isTauri } from '@tauri-apps/api/core';
import { keyPair } from '../../../../shared/remote-chat/cipher';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import type { NativeChatTarget, NativeSessionCipher, SessionOptions, TransferCipherContext }
  from '../../../../shared/remote-chat/nativeSessionCipher';

const MAX_BATCH = 32;
// NativePackets bounds each direction to 96 operations, including control-frame reservations.
const MAX_PENDING = 192;
type Operation = { kind: 'encrypt'; text: string; compress: boolean } | { kind: 'decrypt'; payload: string }
  | { kind: 'send'; text: string; compress: boolean; target: NativeChatTarget };
interface Pending {
  operation: Operation; resolve: (value: string | null) => void; reject: (reason: unknown) => void;
}

/** Batch IPC without a timer; key derivation, nonce allocation, replay checks and AEAD stay in Rust. */
class DesktopSessionCipher implements NativeSessionCipher {
  readonly native = true;
  readonly handle: Promise<string>;
  private readonly queue: Pending[] = [];
  private scheduled = false;
  private running = false;
  private closed = false;
  private outgoing = Promise.resolve();
  private pending = 0;

  constructor(options: SessionOptions, private readonly batchObserved?: (packets: number) => void) {
    const secret = Array.from(options.secret);
    this.handle = invoke<string>('remote_chat_crypto_open', { request: {
      secret, publicKey: options.publicKey, sessionId: options.sessionId, desktop: options.desktop,
    } }).finally(() => secret.fill(0));
    // Opening can reject before a first packet arrives. Packet operations still receive the original rejection.
    void this.handle.catch(() => {});
  }

  async encrypt(text: string, compress = false) {
    const result = await this.run({ kind: 'encrypt', text, compress });
    if (result === null) throw new Error('CHAT_PACKET_CODEC');
    return result;
  }
  decrypt(payload: string) { return this.run({ kind: 'decrypt', payload }); }
  async sendDirect(target: NativeChatTarget, text: string, compress = false) {
    await this.run({ kind: 'send', text, compress, target });
  }

  private run(operation: Operation) {
    if (this.closed || this.pending >= MAX_PENDING) return Promise.reject(new Error('CHAT_PACKET_CODEC'));
    this.pending++;
    const result = new Promise<string | null>((resolve, reject) => { this.queue.push({ operation, resolve, reject }); });
    this.schedule();
    return result.finally(() => { this.pending--; });
  }

  private flush() {
    this.scheduled = false;
    if (this.running || !this.queue.length) return;
    this.running = true;
    this.outgoing = this.drain().catch(error => {
      this.queue.splice(0).forEach(item => item.reject(error));
    }).finally(() => {
      this.running = false;
      if (this.queue.length) this.schedule();
    });
  }

  private schedule() {
    if (this.closed || this.scheduled || this.running) return;
    this.scheduled = true; queueMicrotask(() => this.flush());
  }

  private async drain() {
    const id = await this.handle;
    // Take the next batch only after the previous IPC completes. Producers yield between fragments,
    // so freezing batches in each microtask otherwise creates a queue of one-packet IPC calls.
    while (this.queue.length) await this.processBatch(id, this.queue.splice(0, MAX_BATCH));
  }

  private async processBatch(id: string, batch: Pending[]) {
    try {
      if (this.closed) throw new Error('CHAT_PACKET_CODEC');
      this.batchObserved?.(batch.length);
      const result = await invoke<(string | null)[]>('remote_chat_crypto_batch', {
        id, operations: batch.map(item => item.operation),
      });
      if (this.closed || result.length !== batch.length) throw new Error('CHAT_PACKET_CODEC');
      batch.forEach((item, index) => item.resolve(result[index]));
    } catch (error) { batch.forEach(item => item.reject(error)); }
  }

  async createBulkCipher(context: TransferCipherContext) {
    if (this.closed) throw new Error('CHAT_PACKET_CODEC');
    const keys = await invoke<{ sendKey: number[]; receiveKey: number[] }>('remote_chat_crypto_bulk_keys', {
      id: await this.handle, context,
    });
    const sendKey = Uint8Array.from(keys.sendKey), receiveKey = Uint8Array.from(keys.receiveKey);
    try {
      if (this.closed) throw new Error('CHAT_PACKET_CODEC');
      return new BulkCipher({ sendKey, receiveKey }, context);
    } finally { keys.sendKey.fill(0); keys.receiveKey.fill(0); sendKey.fill(0); receiveKey.fill(0); }
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.queue.splice(0).forEach(item => item.reject(new Error('CHAT_PACKET_CODEC')));
    void this.outgoing.then(() => this.handle).then(id => invoke('remote_chat_crypto_close', { id }))
      .catch(() => { /* A closed application or failed open has no reachable native session. */ });
  }
}

export async function createDesktopKeyPair() {
  if (!isTauri()) return keyPair(size => crypto.getRandomValues(new Uint8Array(size)));
  const pair = await invoke<{ secret: number[]; publicKey: string }>('remote_chat_crypto_keypair');
  const secret = Uint8Array.from(pair.secret); pair.secret.fill(0);
  return { secret, publicKey: pair.publicKey };
}

/** Browser fixtures keep the shared Web implementation; Tauri never falls back after a native failure. */
export const desktopSessionCrypto = isTauri() ? {
  createSessionCipher: createDesktopSessionCipher,
  createKeyPair: createDesktopKeyPair,
} : {};

export function createDesktopSessionCipher(options: SessionOptions, batchObserved?: (packets: number) => void) {
  return new DesktopSessionCipher(options, batchObserved);
}
