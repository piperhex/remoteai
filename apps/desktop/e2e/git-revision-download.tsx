import { useEffect, useSyncExternalStore } from 'react';
import type { GitClient } from '../../../shared/remote-chat/gitTypes';
import type { DownloadClient } from '../../../shared/remote-chat/downloads';
import { downloadManager } from '../../../shared/downloads/manager';
import { DownloadCard } from '../../../shared/downloads/DownloadCard';
import '../../../shared/downloads/styles.css';

const PATCH = 'diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-old\n+new\n';
const bytes = new TextEncoder().encode(PATCH);
const client: DownloadClient = {
  open: async options => {
    if (!options.gitCommit || !options.cwd) throw new Error('Missing patch source');
    return { id: options.transferId, size: bytes.length, name: `${options.gitCommit.slice(0, 12)}.patch`,
      mimeType: 'text/x-patch', revision: options.gitCommit };
  },
  read: async options => ({ offset: options.offset, data: btoa(PATCH.slice(options.offset,
    options.offset + options.length)) }),
  close: async () => undefined,
  browse: async () => ({ directory: '', parent: null, entries: [], truncated: false }),
};
const files = { open: async () => { throw new Error('Not used'); }, read: client.read, close: client.close };

export function GitRevisionDownloads({ git }: { git: GitClient }) {
  const tasks = useSyncExternalStore(downloadManager.subscribe, downloadManager.snapshot);
  useEffect(() => {
    downloadManager.register({ owner: 'fixture', deviceId: 'remote-computer', deviceName: '远程电脑',
      ready: true, mode: 'direct', files, client, git });
    void downloadManager.initialize();
    return () => downloadManager.unbind(files);
  }, [git]);
  return <section aria-label="下载管理">{tasks.map(task => <DownloadCard key={task.id} task={task}
    busy={false} connected action={() => void downloadManager.save(task.id)}
    open={() => void downloadManager.open(task.id)} remove={() => void downloadManager.remove(task.id)} />)}</section>;
}
