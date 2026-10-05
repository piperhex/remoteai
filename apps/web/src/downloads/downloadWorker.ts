import { BulkError, bulkError } from '../../../../shared/remote-chat/bulkLimits';
import type { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import type { BulkHeader } from '../../../../shared/remote-chat/bulkProtocol';

interface Reply { id: number; error?: string; bytes: Uint8Array; header: BulkHeader }
export class DownloadWorker {
  private readonly worker = new Worker(new URL('./hashWorker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private closed = false;
  constructor() {
    this.worker.onmessage = (event: MessageEvent<Reply>) => {
      const pending = this.pending.get(event.data.id); this.pending.delete(event.data.id);
      if (event.data.error) pending?.reject(bulkError(event.data.error)); else pending?.resolve(event.data);
    };
    this.worker.onerror = () => this.close();
  }
  private call(message: object, transfers: Transferable[] = []) {
    if (this.closed) return Promise.reject(new BulkError('CANCELLED'));
    return new Promise<Reply>((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...message, id }, transfers);
    });
  }
  async initialize(cipher: BulkCipher) {
    const material = cipher.receiverMaterial();
    try { await this.call({ action: 'init', material }, [material.key.buffer]); }
    finally { cipher.destroy(); }
  }
  decode = (bytes: Uint8Array) => this.call({ action: 'decode', bytes }, [bytes.buffer]);
  verify = async (bytes: Uint8Array, expected: string) =>
    (await this.call({ action: 'verify', bytes, expected }, [bytes.buffer])).bytes;
  update = async (bytes: Uint8Array) => { await this.call({ action: 'update', bytes }, [bytes.buffer]); };
  finish = async (expected: string) => { await this.call({ action: 'finish', expected }); };
  close() {
    this.closed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new BulkError('CANCELLED'));
    this.pending.clear();
  }
}
