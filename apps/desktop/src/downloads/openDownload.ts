import { invoke, isTauri } from '@tauri-apps/api/core';
import { openBrowserDownload, verifiedDownloadContent } from '../../../../shared/downloads/openDownload';
import type { DownloadTask } from '../../../../shared/downloads/types';

const OPEN_CHUNK_BYTES = 256 * 1024;

export async function openDesktopDownload(task: DownloadTask) {
  if (!isTauri()) return openBrowserDownload(task);
  return performDesktopDownload(task, 'open');
}

export async function revealDesktopDownload(task: DownloadTask) {
  if (!isTauri()) throw new Error('Local file manager unavailable');
  return performDesktopDownload(task, 'reveal');
}

async function performDesktopDownload(task: DownloadTask, action: 'open' | 'reveal') {
  const blob = await verifiedDownloadContent(task);
  const id = await invoke<string>('download_file_action', {
    request: { action: 'begin', name: task.name, size: blob.size },
  });
  try {
    for (let offset = 0; offset < blob.size; offset += OPEN_CHUNK_BYTES) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + OPEN_CHUNK_BYTES).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await invoke('download_file_action', { request: { action: 'write', id, data: btoa(binary) } });
    }
    await invoke('download_file_action', { request: { action, id } });
  } catch (error) {
    await invoke('download_file_action', { request: { action: 'cancel', id } })
      .catch(() => console.warn('Could not remove the temporary download.'));
    throw error;
  }
}
