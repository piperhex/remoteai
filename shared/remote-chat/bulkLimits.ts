/** Conservative application budgets; none of these enlarge the RPC delivery window. */
export const BULK_LIMITS = {
  version: 1, blockBytes: 1024 * 1024, recordBytes: 16 * 1024,
  peerRequestBytes: 2 * 1024 * 1024, maxPeerRequestBytes: 8 * 1024 * 1024,
  globalRequestBytes: 16 * 1024 * 1024, applicationBytes: 32 * 1024 * 1024,
  transportHighBytes: 256 * 1024, transportLowBytes: 64 * 1024,
  activeFiles: 2, hashesPerPage: 256, maxBlocks: 65_536,
  commitBytes: 4 * 1024 * 1024, commitMs: 250, progressMs: 250,
  stallMs: 30_000, prepareMs: 15 * 60_000, hashRetries: 2,
} as const;

export type BulkErrorCode = 'INVALID_RECORD' | 'INVALID_MANIFEST' | 'SOURCE_CHANGED' | 'INTEGRITY_FAILED'
  | 'REPLAY' | 'EPOCH_EXPIRED' | 'CREDIT_EXCEEDED' | 'RESOURCE_LIMIT' | 'STORAGE_FAILED'
  | 'PATH_UNAVAILABLE' | 'CANCELLED';

const messages: Record<BulkErrorCode, string> = {
  INVALID_RECORD: '下载数据无效，请重新连接后重试。',
  INVALID_MANIFEST: '无法确认文件内容，请重新下载。',
  SOURCE_CHANGED: '源文件已更新，请重新下载。',
  INTEGRITY_FAILED: '文件校验失败，请重试。',
  REPLAY: '下载连接验证失败，请重新连接。',
  EPOCH_EXPIRED: '下载连接已切换，请继续下载。',
  CREDIT_EXCEEDED: '下载连接验证失败，请重新连接。',
  RESOURCE_LIMIT: '下载任务较多，请稍后重试。',
  STORAGE_FAILED: '无法保存文件，请检查可用空间和保存权限。',
  PATH_UNAVAILABLE: '下载连接已中断，请重新连接后继续。',
  CANCELLED: '下载已暂停。',
};

export class BulkError extends Error {
  constructor(readonly code: BulkErrorCode) { super(messages[code]); }
}

export function bulkError(error: unknown) {
  if (error instanceof BulkError) return error;
  const code = error instanceof Error ? error.message : String(error);
  return new BulkError(Object.prototype.hasOwnProperty.call(messages, code) ? code as BulkErrorCode : 'INTEGRITY_FAILED');
}

export function bulkAssert(condition: unknown, code: BulkErrorCode): asserts condition {
  if (!condition) throw new BulkError(code);
}
