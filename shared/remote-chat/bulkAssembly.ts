import { bulkAssert } from './bulkLimits';
import type { BulkHeader } from './bulkProtocol';
import { verifyBlock } from './downloadManifest';

/** Reliable ordered records need neither a per-frame ACK window nor overlapping fragment storage. */
export class BulkAssembly {
  private readonly bytes: Uint8Array;
  private received = 0;
  constructor(readonly request: { requestId: string; block: number; length: number; hash: string },
    private readonly verify = true) {
    this.bytes = new Uint8Array(request.length);
  }
  accept(header: BulkHeader, bytes: Uint8Array) {
    bulkAssert(header.requestId === this.request.requestId && header.block === this.request.block
      && header.offset === this.received && header.length === bytes.length
      && this.received + bytes.length <= this.bytes.length, 'INVALID_RECORD');
    this.bytes.set(bytes, this.received);
    this.received += bytes.length;
    if (this.received !== this.bytes.length) return undefined;
    if (this.verify) verifyBlock(this.bytes, this.request.hash);
    return this.bytes;
  }
}
