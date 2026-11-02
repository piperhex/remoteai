import { ChatRpc } from '../remote-chat/rpc';
import type { RpcMessage, RpcRequest } from '../remote-chat/protocol';
import { base64Bytes } from '../remote-chat/policy';
import { ATTACHMENT_CHUNK_BYTES, type AttachmentSource, type AttachmentSink, type LoungeAttachment } from './attachments';

const PROTOCOL = 'lounge-attachment-v1';

/** Bounded, acknowledged chunks keep large files out of message frames and whole-file base64 buffers. */
export class AttachmentExchange {
  private readonly rpc: ChatRpc;
  private serving = false;
  private readonly requests: RpcRequest[] = [];
  private closed = false;
  constructor(private readonly options: {
    fileId: string; source: () => AttachmentSource | undefined | Promise<AttachmentSource | undefined>;
    send: (message: RpcMessage) => Promise<void>;
  }) {
    this.rpc = new ChatRpc({ send: options.send, prefix: 'attachment', event: () => {} });
  }
  receive(message: RpcMessage) {
    if (this.closed) return;
    if (message.kind === 'request') {
      if (this.requests.length >= 2) { this.close(); return; }
      this.requests.push(message); void this.serve(); return;
    }
    this.rpc.receive(message);
  }
  private async serve() {
    if (this.serving || this.closed) return;
    this.serving = true;
    try { while (!this.closed && this.requests.length) await this.answer(this.requests.shift()!); }
    finally { this.serving = false; }
  }
  private async answer(message: RpcRequest) {
    try {
      const body = message.body as { protocol?: string; offset?: number; length?: number } | undefined;
      const file = await this.options.source();
      if (message.method !== 'request' || !file || body?.protocol !== PROTOCOL || !Number.isSafeInteger(body.offset)
        || !Number.isSafeInteger(body.length) || body.offset! < 0 || body.length! < 1
        || body.length! > ATTACHMENT_CHUNK_BYTES || body.offset! + body.length! > file.size) {
        throw new Error('client.lounge.fileUnavailable');
      }
      const data = await file.read(body.offset!, body.length!);
      await this.options.send({ kind: 'response', id: message.id, data });
    } catch {
      if (!this.closed) await this.options.send({ kind: 'response', id: message.id,
        error: 'client.lounge.fileUnavailable' }).catch(() => this.close());
    }
  }
  async download(file: LoungeAttachment, sink: AttachmentSink, options: {
    signal?: AbortSignal; progress?: (fraction: number) => void;
  } = {}) {
    const cancel = () => this.close();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (this.closed || options.signal?.aborted) throw new Error('client.lounge.fileUnavailable');
      for (let offset = 0; offset < file.size; offset += ATTACHMENT_CHUNK_BYTES) {
        if (this.closed || options.signal?.aborted) throw new Error('client.lounge.fileUnavailable');
        const length = Math.min(ATTACHMENT_CHUNK_BYTES, file.size - offset);
        const data = await this.read(offset, length);
        await sink.write(data);
        options.progress?.((offset + length) / file.size);
      }
      if (this.closed || options.signal?.aborted) throw new Error('client.lounge.fileUnavailable');
      return await sink.finish();
    } catch (error) { await sink.abort(); throw error; }
    finally { options.signal?.removeEventListener('abort', cancel); }
  }
  async read(offset: number, length: number): Promise<string> {
    if (this.closed) throw new Error('client.lounge.fileUnavailable');
    const data = await this.rpc.request<unknown>('request', { protocol: PROTOCOL, offset, length });
    if (typeof data !== 'string' || data.length > Math.ceil(length / 3) * 4
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || base64Bytes(data) !== length) {
      throw new Error('client.lounge.fileUnavailable');
    }
    return data;
  }
  close() { this.closed = true; this.requests.length = 0; this.rpc.close(); }
}
