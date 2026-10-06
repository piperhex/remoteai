import { t } from '../i18n';
import { useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { FileClient } from '../../../../shared/remote-chat/fileDownload';
import { useFileDownload } from '../../../../shared/remote-chat/useFileDownload';
import { downloadDetail } from './presentation';
import { nativeDownloadTarget } from '../chat/fileDownloadTarget';
import { downloadManager } from './manager';

interface Options { client: FileClient; threadId: string | null; path: string; ready: boolean }

function useAndroidDownload(options: Options) {
  const tasks = useSyncExternalStore(downloadManager.subscribe, downloadManager.snapshot);
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const connection = downloadManager.connection();
  const task = [...tasks].reverse().find(item => item.source.path === options.path
    && !item.source.preview && item.source.scope === 'project'
    && item.source.threadId === options.threadId && item.source.owner === connection?.owner
    && item.source.deviceId === connection?.deviceId);
  const busy = starting || !!task && ['queued', 'preparing', 'downloading', 'verifying', 'saving'].includes(task.status);
  const percent = task?.size ? Math.floor(task.received / task.size * 100) : 0;
  const start = async () => {
    if (starting || (!options.ready && task?.status !== 'completed')
      || !connection || connection.files !== options.client) return;
    setStarting(true); setMessage('');
    try {
      if (task && task.status !== 'completed') await downloadManager.resume(task.id);
      else if (task) await downloadManager.open(task);
      else {
        await downloadManager.enqueue({ owner: connection.owner, deviceId: connection.deviceId,
          deviceName: connection.deviceName, scope: 'project', threadId: options.threadId ?? undefined,
          cwd: connection.cwd, path: options.path });
        setMessage(t("已加入下载管理，关闭此窗口后仍会继续下载。"));
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : t("暂时无法下载，请重试。")); }
    finally { setStarting(false); }
  };
  const pause = () => {
    if (task) void downloadManager.pause(task.id).catch(() => setMessage(t("暂时无法暂停，请重试。")));
  };
  let label = t("下载");
  if (busy) label = t("暂停下载 · {value1}%", { value1: percent });
  else if (task?.status === 'completed') label = t("打开文件");
  else if (task) label = t("继续下载");
  const detail = task ? downloadDetail(task) : '';
  return { busy, label, detail, completed: task?.status === 'completed',
    message: task?.message || message, start, cancel: pause };
}

// Each installed platform selects one stable hook implementation for its lifetime.
export const useManagedDownload = Platform.OS === 'android' ? useAndroidDownload : (options: Options) => ({
  ...useFileDownload({ ...options, target: nativeDownloadTarget, success: t("文件已保存到下载文件夹") }), completed: false,
});
