import type { BulkCapability } from './bulkProtocol';
import { BULK_LIMITS } from './bulkLimits';
import type { DownloadManifest, ManifestPage } from './downloadManifest';
import type { BulkPath, BulkTransport } from './bulkTransport';
import type { BulkCipher } from './bulkCipher';

export const BULK_OPERATION = 'fileBulk';
export const BULK_ERROR_EVENT = 'fileBulkError';
export const bulkCapability = (storage: BulkCapability['storage'], recordBytes: number = BULK_LIMITS.recordBytes)
  : BulkCapability => ({
  version: 1, binary: true, recordBytes, blockBytes: BULK_LIMITS.blockBytes,
  receiveBytes: BULK_LIMITS.peerRequestBytes, storage,
});
export interface BulkOpen {
  transferId: string; id: string; epoch: string; path: BulkPath; capability: BulkCapability;
}
export interface BulkOpened {
  transferId: string; epoch: string; path: BulkPath; capability: BulkCapability; manifest: DownloadManifest;
}
export interface BulkRequest {
  transferId: string; epoch: string; manifestId: string; requestId: string; requestNumber: number;
  block: number; granted: number;
}
export interface BulkClient {
  readonly peer: string;
  available: () => boolean;
  path: () => BulkPath | undefined;
  transport: () => BulkTransport | undefined;
  open: (options: BulkOpen, signal?: AbortSignal) => Promise<BulkOpened>;
  page: (transferId: string, page: number) => Promise<ManifestPage>;
  request: (request: BulkRequest) => Promise<void>;
  cancel: (transferId: string, epoch: string) => Promise<void>;
  cipher: (options: { transferId: string; manifestId: string; epoch: string }) => BulkCipher;
}
