import { t } from '../i18n';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AuthSession } from '../types';
import { downloadManager, downloadOwner } from './manager';
import type { DownloadTask } from './types';

export function useDownloadTasks(session: AuthSession) {
  const tasks = useSyncExternalStore(downloadManager.subscribe, downloadManager.snapshot);
  const connection = useSyncExternalStore(downloadManager.subscribe, downloadManager.connection);
  const initializationError = useSyncExternalStore(downloadManager.subscribe, downloadManager.error);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [deleting, setDeleting] = useState<DownloadTask>();
  const pending = useRef(false);
  const owner = downloadOwner(session);
  useEffect(() => { void downloadManager.initialize(); }, []);

  const run = async (task: DownloadTask, operation: 'action' | 'delete') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(task.id);
    setError('');
    try {
      if (operation === 'delete') {
        await downloadManager.delete(task.id);
        setDeleting(undefined);
      } else if (task.status === 'completed') await downloadManager.open(task);
      else if (['queued', 'preparing', 'downloading', 'verifying', 'saving'].includes(task.status)) {
        await downloadManager.pause(task.id);
      }
      else await downloadManager.resume(task.id);
    } catch {
      setError(operation === 'delete' ? t("删除未完成，请稍后重试。")
        : t("操作未完成，请检查电脑连接、手机空间或是否有可打开此文件的应用。"));
    } finally {
      pending.current = false;
      setBusy('');
    }
  };

  return {
    tasks: tasks.filter(task => task.source.owner === owner).slice().reverse(),
    connection: connection?.owner === owner ? connection : undefined,
    error: error || initializationError, busy, deleting, setDeleting, run,
  };
}
