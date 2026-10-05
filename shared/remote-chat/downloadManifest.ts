import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { BULK_LIMITS, bulkAssert } from './bulkLimits';

const DOMAIN = 'remote-ai:file-manifest:v1:sha256\0';
const HASH = /^[a-f0-9]{64}$/;
export interface DownloadManifest {
  version: 1; algorithm: 'sha256'; manifestId: string; size: number; blockSize: number;
  blockCount: number; fileHash: string; sourceVersion: string;
}
export interface ManifestPage { manifestId: string; page: number; totalPages: number; hashes: string[] }
export interface DownloadCheckpoint {
  version: 1; manifestId: string; size: number; blockSize: number; temporaryId: string;
  sequence: number; committed: number[];
}

export function validateManifest(value: DownloadManifest): DownloadManifest {
  bulkAssert(value && value.version === 1 && value.algorithm === 'sha256'
    && HASH.test(value.manifestId) && HASH.test(value.fileHash)
    && Number.isSafeInteger(value.size) && value.size >= 0
    && value.blockSize === BULK_LIMITS.blockBytes
    && value.blockCount === Math.ceil(value.size / value.blockSize)
    && value.blockCount <= BULK_LIMITS.maxBlocks
    && typeof value.sourceVersion === 'string' && value.sourceVersion.length <= 256, 'INVALID_MANIFEST');
  return value;
}

/** Fixed big-endian integers and raw digests, shared with the Rust and Android implementations. */
export function manifestHasher(manifest: Pick<DownloadManifest, 'size' | 'blockSize' | 'blockCount'>) {
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  view.setBigUint64(0, BigInt(manifest.size));
  view.setUint32(8, manifest.blockSize);
  view.setUint32(12, manifest.blockCount);
  return sha256.create().update(utf8ToBytes(DOMAIN)).update(header);
}

export function validateManifestPage(manifest: DownloadManifest, page: ManifestPage, index: number) {
  const total = Math.ceil(manifest.blockCount / BULK_LIMITS.hashesPerPage);
  const count = Math.min(BULK_LIMITS.hashesPerPage, manifest.blockCount - index * BULK_LIMITS.hashesPerPage);
  bulkAssert(page && Number.isSafeInteger(index) && index >= 0 && index < total
    && page.manifestId === manifest.manifestId && page.page === index && page.totalPages === total
    && Array.isArray(page.hashes) && page.hashes.length === count
    && page.hashes.every(hash => typeof hash === 'string' && HASH.test(hash)), 'INVALID_MANIFEST');
  return page;
}

export async function authenticateManifest(options: {
  manifest: DownloadManifest; read: (page: number) => Promise<ManifestPage>;
  store: (page: ManifestPage) => Promise<void>; signal: AbortSignal;
}) {
  const manifest = validateManifest(options.manifest);
  const digest = manifestHasher(manifest);
  const pages = Math.ceil(manifest.blockCount / BULK_LIMITS.hashesPerPage);
  for (let index = 0; index < pages; index += 1) {
    bulkAssert(!options.signal.aborted, 'CANCELLED');
    const page = validateManifestPage(manifest, await options.read(index), index);
    for (const hash of page.hashes) digest.update(hexToBytes(hash));
    await options.store(page);
  }
  bulkAssert(bytesToHex(digest.update(hexToBytes(manifest.fileHash)).digest()) === manifest.manifestId,
    'INVALID_MANIFEST');
}

export function blockLength(manifest: DownloadManifest, block: number) {
  bulkAssert(Number.isSafeInteger(block) && block >= 0 && block < manifest.blockCount, 'INVALID_RECORD');
  return Math.min(manifest.blockSize, manifest.size - block * manifest.blockSize);
}

export function verifyBlock(bytes: Uint8Array, hash: string) {
  bulkAssert(HASH.test(hash) && bytesToHex(sha256(bytes)) === hash, 'INTEGRITY_FAILED');
}

/** Metadata alone never promotes legacy offsets to committed bulk blocks. */
export function checkpointBlocks(manifest: DownloadManifest, checkpoint?: DownloadCheckpoint, temporaryId?: string) {
  if (!checkpoint || checkpoint.version !== 1 || checkpoint.manifestId !== manifest.manifestId
    || checkpoint.size !== manifest.size || checkpoint.blockSize !== manifest.blockSize
    || (temporaryId !== undefined && checkpoint.temporaryId !== temporaryId)
    || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0
    || !Array.isArray(checkpoint.committed) || checkpoint.committed.length > manifest.blockCount) return [];
  return [...new Set(checkpoint.committed.filter(block => Number.isSafeInteger(block)
    && block >= 0 && block < manifest.blockCount))].sort((left, right) => left - right);
}
