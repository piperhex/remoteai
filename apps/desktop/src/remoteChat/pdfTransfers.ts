import { guiApi } from '../../../../shared/conversation/api';
import type { Request } from '../../../../shared/conversation/types';
import { checkFilePreviewSize, textPreviewByteLimit } from '../../../../shared/remote-chat/policy';
import { validateFileInfo, type FileInfo } from '../../../../shared/remote-chat/fileDownload';
import { BulkError } from '../../../../shared/remote-chat/bulkLimits';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

interface Transfer { owner: string; threadId: string; size: number }

/** Bind preview limits to host-created handles, never to a size or mode supplied by the viewer. */
export class RemotePdfTransfers {
  private readonly transfers = new Map<string, Transfer>();
  private readonly pending = new Set<{ owner: string }>();

  handles(body: Record<string, unknown>) {
    return body.operation === 'fileOpen' && body.preview === 'pdf'
      || body.operation === 'downloadOpen' && body.filePreview === 'pdf'
      || ['fileRead', 'fileClose'].includes(String(body.operation)) && this.transfers.has(String(body.id));
  }

  async request(body: Record<string, unknown>, options: { owner: string; mode: ConnectionMode }) {
    if (body.operation === 'fileOpen' || body.operation === 'downloadOpen') return this.open(body, options);
    const id = String(body.id);
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.owner !== options.owner || transfer.threadId !== body.threadId) {
      throw new BulkError('PREVIEW_UNAVAILABLE');
    }
    if (body.operation === 'fileClose') this.transfers.delete(id);
    else checkFilePreviewSize(transfer.size, options.mode);
    return guiApi.request({ ...body, maxBytes: textPreviewByteLimit(options.mode) } as unknown as Request);
  }

  private async open(body: Record<string, unknown>, options: { owner: string; mode: ConnectionMode }) {
    if (typeof body.path !== 'string' || !/\.pdf$/i.test(body.path)) throw new BulkError('PREVIEW_UNAVAILABLE');
    const threadId = body.operation === 'downloadOpen' ? body.transferId : body.threadId;
    if (typeof threadId !== 'string') throw new BulkError('PREVIEW_UNAVAILABLE');
    const pending = { owner: options.owner };
    this.pending.add(pending);
    let info: FileInfo | undefined;
    try {
      info = await guiApi.request<FileInfo>({ ...body, maxBytes: textPreviewByteLimit(options.mode) } as unknown as Request);
      validateFileInfo(info, options.mode, size => checkFilePreviewSize(size, options.mode));
      if (!this.pending.has(pending)) throw new BulkError('PREVIEW_UNAVAILABLE');
      this.transfers.set(info.id, { owner: options.owner, threadId, size: info.size });
      return info;
    } catch (error) {
      if (info?.id) await this.close(info.id, threadId);
      throw error;
    } finally { this.pending.delete(pending); }
  }

  private async close(id: string, threadId: string) {
    await guiApi.request({ operation: 'fileClose', id, threadId })
      .catch(() => console.warn('PDF preview cleanup failed'));
  }

  release(owner?: string) {
    for (const entry of this.pending) if (owner === undefined || entry.owner === owner) this.pending.delete(entry);
    for (const [id, transfer] of this.transfers) {
      if (owner !== undefined && transfer.owner !== owner) continue;
      this.transfers.delete(id); void this.close(id, transfer.threadId);
    }
  }
}
