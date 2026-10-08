import { base64Bytes, checkDownloadSize, getChatPolicy } from './policy';
import type { ConnectionMode } from './protocol';

export const FILE_CHUNK_BYTES = 256 * 1024;
export interface FileInfo { id: string; size: number; name: string; mimeType: string; revision?: string }
export interface FileRead { threadId: string; id: string; offset: number; length: number }
export interface FileChunk { offset: number; data: string }
export type FileRequest =
  | { operation: 'fileOpen'; threadId: string; path: string; maxBytes?: number }
  | ({ operation: 'fileRead'; maxBytes?: number } & FileRead)
  | { operation: 'fileClose'; threadId: string; id: string };
export interface FileClient {
  open: (threadId: string, path: string) => Promise<FileInfo>;
  read: (request: FileRead) => Promise<FileChunk>;
  close: (threadId: string, id: string) => Promise<unknown>;
}
export interface DownloadTarget {
  write: (base64: string) => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
}
export interface DownloadOptions {
  client: FileClient; threadId: string; path: string; signal: AbortSignal;
  target: (info: FileInfo) => Promise<DownloadTarget>;
  progress: (received: number, total: number) => void;
}
export class DownloadCancelled extends Error {}
function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DownloadCancelled();
}
export function validateFileInfo(info: FileInfo, mode?: ConnectionMode) {
  if (!info || typeof info.id !== 'string' || !/^[a-z\d-]{36}$/i.test(info.id)
    || !Number.isSafeInteger(info.size) || info.size < 0
    || typeof info.name !== 'string' || !info.name || /[\\/\x00-\x1f\x7f]/.test(info.name)
    || info.name === '.' || info.name === '..' || typeof info.mimeType !== 'string') {
    throw new Error('文件信息无效，请重试。');
  }
  checkDownloadSize(info.size, mode);
  return info;
}
export function validateChunk(chunk: FileChunk, offset: number, length: number) {
  if (!chunk || chunk.offset !== offset || typeof chunk.data !== 'string'
    || chunk.data.length !== Math.ceil(length / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)
    || base64Bytes(chunk.data) !== length) throw new Error('文件下载不完整，请重试。');
}
type ReadResult = { chunk: FileChunk } | { error: unknown };
interface PendingRead { offset: number; length: number; result: Promise<ReadResult> }
function readAhead(client: Pick<FileClient, 'read'>, request: FileRead): PendingRead {
  const result = client.read(request).then((chunk): ReadResult => ({ chunk }),
    (error: unknown): ReadResult => ({ error }));
  return { offset: request.offset, length: request.length, result };
}
interface ChunkTransferOptions {
  client: Pick<FileClient, 'read'>; threadId: string; info: FileInfo; signal: AbortSignal; offset?: number;
  write: (chunk: FileChunk, received: number) => Promise<void>;
  mode?: () => ConnectionMode;
}
/** Bound both outstanding reads and buffered replies; commit resumed ranges in file order. */
export async function transferFileChunks(options: ChunkTransferOptions) {
  const { client, threadId, info, signal, write } = options;
  const pending: PendingRead[] = [];
  let nextOffset = options.offset ?? 0;
  if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > info.size) {
    throw new Error('下载进度无效，请重新下载。');
  }
  const fill = () => {
    checkCancelled(signal);
    checkDownloadSize(info.size, options.mode?.());
    const window = getChatPolicy(options.mode?.()).fileDownloadWindowSize;
    while (pending.length < window && nextOffset < info.size) {
      const length = Math.min(FILE_CHUNK_BYTES, info.size - nextOffset);
      pending.push(readAhead(client, { threadId, id: info.id, offset: nextOffset, length }));
      nextOffset += length;
    }
  };
  fill();
  while (pending.length) {
    const read = pending.shift()!;
    const result = await read.result;
    checkCancelled(signal);
    checkDownloadSize(info.size, options.mode?.());
    if ('error' in result) throw result.error;
    validateChunk(result.chunk, read.offset, read.length);
    await write(result.chunk, read.offset + read.length);
    fill();
  }
  checkCancelled(signal);
}
/** Pipeline bounded reads, keep disk writes ordered, and always release local and remote resources. */
export async function downloadFile(options: DownloadOptions) {
  checkCancelled(options.signal);
  const info = await options.client.open(options.threadId, options.path);
  let target: DownloadTarget | undefined;
  try {
    validateFileInfo(info);
    checkCancelled(options.signal);
    target = await options.target(info);
    const destination = target;
    options.progress(0, info.size);
    await transferFileChunks({ ...options, info, write: async (chunk, received) => {
      await destination.write(chunk.data);
      options.progress(received, info.size);
    } });
    await destination.finish();
  } finally {
    await target?.dispose().catch(() => console.warn('Unable to remove temporary download'));
    if (typeof info?.id === 'string') {
      await options.client.close(options.threadId, info.id)
        .catch(() => console.warn('Unable to close remote download; it will expire automatically'));
    }
  }
}
