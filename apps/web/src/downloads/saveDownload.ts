import { DownloadCancelled } from '../../../../shared/remote-chat/fileDownload';
import { downloadBlob } from '../chat/fileDownloadTarget';
import { downloadContent, readStoredBlock } from './storage';
import type { DownloadTask } from './types';
import { bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { BULK_LIMITS } from '../../../../shared/remote-chat/bulkLimits';
import { DownloadWorker } from './downloadWorker';
import { DownloadMetrics } from '../../../../shared/remote-chat/downloadMetrics';

interface SaveHandle { createWritable(): Promise<FileSystemWritableFileStream> }
interface SavePicker { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> }

export async function verifySnapshot(task: DownloadTask, blob: Blob) {
  bulkAssert(blob.size === task.size, 'INTEGRITY_FAILED');
  if (!task.manifest) return;
  const worker = new DownloadWorker();
  try {
    for (let offset = 0; offset < blob.size; offset += BULK_LIMITS.blockBytes) {
      await worker.update(new Uint8Array(await blob.slice(offset, offset + BULK_LIMITS.blockBytes).arrayBuffer()));
    }
    await worker.finish(task.manifest.fileHash);
  } finally { worker.close(); }
}

/** An anchor download cannot report completion. Only a successful writable close confirms the final save. */
export async function saveDownload(task: DownloadTask, update: (received: number) => void): Promise<boolean> {
  const metrics = new DownloadMetrics();
  try { return await metrics.measure('saveMs', () => publishDownload(task, update)); }
  finally { metrics.record(); }
}

async function publishDownload(task: DownloadTask, update: (received: number) => void): Promise<boolean> {
  const picker = navigator.userActivation?.isActive === false
    ? undefined : (window as Window & SavePicker).showSaveFilePicker;
  if (!picker) {
    const blob = await downloadContent(task);
    // Verify the immutable Blob actually handed to the browser, not a separate read of IndexedDB.
    await verifySnapshot(task, blob); downloadBlob(blob, task.name); return false;
  }
  let handle: SaveHandle;
  try { handle = await picker.call(window, { suggestedName: task.name }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new DownloadCancelled();
    throw error;
  }
  const output = await handle.createWritable();
  const worker = task.manifest ? new DownloadWorker() : undefined;
  try {
    let offset = 0;
    while (offset < task.size) {
      const blob = await readStoredBlock(task.id, offset);
      bulkAssert(blob && blob.size > 0 && offset + blob.size <= task.size, 'INTEGRITY_FAILED');
      await worker?.update(new Uint8Array(await blob.arrayBuffer()));
      await output.write(blob); offset += blob.size; update(offset);
    }
    if (task.manifest) await worker!.finish(task.manifest.fileHash);
    await output.close();
    return true;
  } catch (error) {
    await output.abort().catch(() => console.warn('The browser could not close the incomplete saved file.'));
    throw error;
  } finally { worker?.close(); }
}
