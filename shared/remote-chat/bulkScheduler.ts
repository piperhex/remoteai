import { BULK_LIMITS, BulkError, bulkAssert } from './bulkLimits';

interface Reservation { peer: string; transfer: string; bytes: number; memory: number }
interface Waiting extends Reservation {
  signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void;
  abort: () => void;
}
const MAX_WAITERS = 128;

/** One instance spans peers and paths. A complete block is reserved before REQUEST, avoiding fragment deadlock. */
export class BulkScheduler {
  private readonly peers = new Map<string, number>();
  private requests = 0;
  private memory = 0;
  private readonly waiting: Waiting[] = [];
  private lastTransfer = '';

  get usage() { return { requestBytes: this.requests, memoryBytes: this.memory, waiting: this.waiting.length }; }

  reserve(options: Reservation & { signal: AbortSignal }): Promise<() => void> {
    bulkAssert(Number.isSafeInteger(options.bytes) && options.bytes > 0
      && options.bytes <= BULK_LIMITS.blockBytes && Number.isSafeInteger(options.memory)
      && options.memory >= options.bytes && options.memory <= BULK_LIMITS.applicationBytes, 'RESOURCE_LIMIT');
    if (options.signal.aborted) return Promise.reject(new BulkError('CANCELLED'));
    if (this.waiting.length >= MAX_WAITERS) return Promise.reject(new BulkError('RESOURCE_LIMIT'));
    return new Promise((resolve, reject) => {
      const entry: Waiting = { ...options, resolve, reject, abort: () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new BulkError('CANCELLED'));
      } };
      options.signal.addEventListener('abort', entry.abort, { once: true });
      this.waiting.push(entry);
      this.drain();
    });
  }

  private fits(entry: Reservation) {
    return this.requests + entry.bytes <= BULK_LIMITS.globalRequestBytes
      && this.memory + entry.memory <= BULK_LIMITS.applicationBytes
      && (this.peers.get(entry.peer) ?? 0) + entry.bytes <= BULK_LIMITS.peerRequestBytes;
  }

  private drain() {
    while (this.waiting.length) {
      // A one-block quantum rotates eligible transfers; records inside each block rotate at the sender.
      let index = this.waiting.findIndex(entry => entry.transfer !== this.lastTransfer && this.fits(entry));
      if (index < 0) index = this.waiting.findIndex(entry => this.fits(entry));
      if (index < 0) return;
      const [entry] = this.waiting.splice(index, 1);
      entry.signal.removeEventListener('abort', entry.abort);
      this.requests += entry.bytes; this.memory += entry.memory;
      this.peers.set(entry.peer, (this.peers.get(entry.peer) ?? 0) + entry.bytes);
      this.lastTransfer = entry.transfer;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.requests -= entry.bytes; this.memory -= entry.memory;
        const remaining = (this.peers.get(entry.peer) ?? 0) - entry.bytes;
        if (remaining) this.peers.set(entry.peer, remaining); else this.peers.delete(entry.peer);
        this.drain();
      });
    }
  }
}

export const bulkScheduler = new BulkScheduler();

/** Credit is a high-water mark, never an increment, and is independent of durable COMMITTED state. */
export class BulkCredit {
  private granted = 0;
  private sent = 0;
  constructor(readonly epoch: string, private readonly capacity = BULK_LIMITS.peerRequestBytes) {}

  update(epoch: string, cumulative: number) {
    bulkAssert(epoch === this.epoch, 'EPOCH_EXPIRED');
    bulkAssert(Number.isSafeInteger(cumulative) && cumulative >= 0, 'CREDIT_EXCEEDED');
    if (cumulative <= this.granted) return;
    bulkAssert(cumulative - this.sent <= this.capacity, 'CREDIT_EXCEEDED');
    this.granted = cumulative;
  }

  consume(bytes: number) {
    bulkAssert(Number.isSafeInteger(bytes) && bytes > 0
      && Number.isSafeInteger(this.sent + bytes) && this.sent + bytes <= this.granted, 'CREDIT_EXCEEDED');
    this.sent += bytes;
  }

  get available() { return this.granted - this.sent; }
}
