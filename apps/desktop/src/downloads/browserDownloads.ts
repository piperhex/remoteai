import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { downloadManager } from '../../../../shared/downloads/manager';
import { registerBrowserDownloads } from '../../../../shared/downloads/browserTasks';
import { DownloadSpeed } from '../../../../shared/downloads/downloadSpeed';
import type { DownloadTask } from '../../../../shared/downloads/types';
import { LOCAL_DOWNLOAD_OWNER } from './localGitDownloads';

export interface BrowserDownloadSnapshot {
  id: string; name: string; origin: string;
  status: 'paused' | 'downloading' | 'completed' | 'failed';
  received: number; size: number; createdAt: number; sequence: number;
  awaitingConfirmation: boolean; canResume: boolean;
}

export type BrowserDownloadNotice = 'confirmation' | 'added' | 'confirmed' | 'failed';

export async function connectBrowserDownloads(notify: (notice: BrowserDownloadNotice) => void) {
  const seen = new Map<string, number>();
  const speeds = new Map<string, DownloadSpeed>();
  const removed = new Set<string>();
  let queue = Promise.resolve();
  const enqueue = (value: BrowserDownloadSnapshot) => {
    queue = queue.then(async () => {
      if (removed.has(value.id) || (seen.get(value.id) ?? -1) >= value.sequence) return;
      const first = !seen.has(value.id);
      const id = `browser-${value.id}`;
      const previous = downloadManager.snapshot().find(task => task.id === id);
      const speed = speeds.get(id) ?? new DownloadSpeed(value.received, Date.now());
      speeds.set(id, speed);
      const task: DownloadTask = { id, name: value.name,
        source: { owner: LOCAL_DOWNLOAD_OWNER, deviceId: 'local', deviceName: value.origin,
          scope: 'computer', path: value.name },
        status: value.status, received: value.received, size: value.size, createdAt: value.createdAt,
        completedAt: value.status === 'completed' ? previous?.completedAt ?? Date.now() : undefined,
        bytesPerSecond: value.status === 'downloading' ? speed.sample(value.received, Date.now()) : undefined,
        message: value.awaitingConfirmation ? 'client.downloads.browser.warning'
          : value.status === 'failed' ? 'client.downloads.browser.failed' : '',
        browser: { id: value.id, awaitingConfirmation: value.awaitingConfirmation, canResume: value.canResume } };
      await downloadManager.updateBrowser(task);
      seen.set(value.id, value.sequence);
      if (first) notify(value.awaitingConfirmation ? 'confirmation' : 'added');
      else if (previous?.browser?.awaitingConfirmation && !value.awaitingConfirmation) notify('confirmed');
    }).catch(async () => {
      // A transfer that cannot be tracked must not silently continue or remain deferred forever.
      await invoke('browser_download_action', { id: value.id, action: 'remove' })
        .catch(() => console.warn('Could not cancel an untracked browser download.'));
      notify('failed');
    });
  };
  const unregister = registerBrowserDownloads(async (id, action) => {
    if (action === 'remove') removed.add(id);
    try {
      if (action === 'remove') await queue;
      await invoke('browser_download_action', { id, action });
    } catch (error) { removed.delete(id); throw error; }
  });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<BrowserDownloadSnapshot>('browser-download', event => enqueue(event.payload));
    const snapshots = await invoke<BrowserDownloadSnapshot[]>('browser_downloads');
    snapshots.forEach(enqueue);
  } catch (error) { unlisten?.(); unregister(); throw error; }
  return () => { unlisten?.(); unregister(); };
}
