import { useRef, useState, useSyncExternalStore } from 'react';
import { useFileDownload } from '../../../../shared/remote-chat/useFileDownload';
import { previewProgressText } from '../../../../shared/chat/previewProgress';
import { t } from '../i18n';
import type { FilePreviewContext } from '../chat/ChatFilePreview';
import { browserDownloadTarget, prepareBrowserDownload } from '../chat/fileDownloadTarget';
import { downloadManager } from './manager';
import type { DownloadConnection } from './types';
import { FileDownloadControl } from './FileDownloadControl';

const DOWNLOAD_STATUS = { queued: '等待下载', preparing: '准备并校验文件', downloading: '下载中',
  verifying: '正在校验', ready: '文件已就绪', saving: '正在保存', paused: '已暂停', completed: '已完成', failed: '下载失败' };

interface Props { path: string; context: FilePreviewContext }

export function FileDownloadButton(props: Props) {
  const connection = useSyncExternalStore(downloadManager.subscribe,
    () => downloadManager.connectionForFile(props.context.client));
  if (connection?.files === props.context.client) return <ManagedDownload {...props} connection={connection} />;
  return <DirectDownload {...props} />;
}

function ManagedDownload({ path, context, connection }: Props & { connection: DownloadConnection }) {
  const tasks = useSyncExternalStore(downloadManager.subscribe, downloadManager.snapshot);
  const task = [...tasks].reverse().find(task => task.source.owner === connection.owner
    && task.source.deviceId === connection.deviceId && task.source.threadId === context.threadId
    && task.source.path === path && task.source.scope === 'project' && !task.source.preview);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const running = task && ['queued', 'preparing', 'downloading', 'verifying'].includes(task.status);
  const completed = task?.status === 'completed' || task?.status === 'ready';
  const progress = task && previewProgressText({ received: task.received, status: task.status,
    total: task.status === 'queued' || task.status === 'preparing' ? undefined : task.size,
    bytesPerSecond: task.status === 'downloading' ? task.bytesPerSecond : undefined });
  const run = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (completed && task) await downloadManager.save(task.id);
      else if (running && task) await downloadManager.pause(task.id);
      else if (task) await downloadManager.resume(task.id);
      else if (context.threadId) await downloadManager.enqueue({ owner: connection.owner,
        deviceId: connection.deviceId, deviceName: connection.deviceName, scope: 'project',
        threadId: context.threadId, path });
    } catch { setError('操作未完成，请检查浏览器存储空间后重试。'); }
    finally { pending.current = false; setBusy(false); }
  };
  let action: 'download' | 'save' | 'pause' | 'resume' = 'download';
  if (completed || task?.status === 'saving') action = 'save';
  else if (running) action = 'pause';
  else if (task) action = 'resume';
  return <FileDownloadControl action={action} onAction={() => { void run(); }}
    disabled={busy || task?.status === 'saving' || (!running && !completed && (!context.ready || !context.threadId))}
    progress={task && progress ? { percent: progress.percent, status: DOWNLOAD_STATUS[task.status],
      detail: `${progress.amount}${task.status === 'downloading' && task.bytesPerSecond ? ` · ${progress.speed}` : ''}`,
    } : undefined} message={error || task?.message}
    note={task ? '下载会在后台继续，可在“下载管理”查看进度。' : undefined} />;
}

function DirectDownload({ path, context }: Props) {
  const download = useFileDownload({ ...context, path, target: browserDownloadTarget,
    prepare: () => prepareBrowserDownload(path), success: t('文件已交给浏览器保存') });
  return <FileDownloadControl action={download.busy ? 'cancel' : 'download'}
    disabled={!download.busy && (!context.ready || !context.threadId)}
    onAction={download.busy ? download.cancel : download.start}
    progress={download.busy ? { percent: download.detail ? download.percent : undefined,
      status: download.detail ? '下载中' : '准备下载', detail: download.detail } : undefined}
    message={download.message} />;
}
