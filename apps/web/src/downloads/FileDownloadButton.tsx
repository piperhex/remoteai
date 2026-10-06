import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, Pause } from 'lucide-react';
import { useFileDownload } from '../../../../shared/remote-chat/useFileDownload';
import { t } from '../i18n';
import type { FilePreviewContext } from '../chat/ChatFilePreview';
import { browserDownloadTarget, prepareBrowserDownload } from '../chat/fileDownloadTarget';
import { downloadManager } from './manager';
import type { DownloadConnection } from './types';

interface Props { path: string; context: FilePreviewContext }

export function FileDownloadButton(props: Props) {
  const connection = useSyncExternalStore(downloadManager.subscribe, downloadManager.connection);
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
  const percent = task?.size ? Math.round(task.received / task.size * 100) : 0;
  let label = t('下载');
  if (completed) label = t('保存到设备');
  else if (running) label = t('暂停下载 · {percent}%', { percent });
  else if (task) label = t('继续下载');
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
  return <div><button type="button" className="chat-button" onClick={() => { void run(); }}
    disabled={busy || task?.status === 'saving' || (!running && !completed && (!context.ready || !context.threadId))}>
    {running ? <Pause size={15} /> : <Download size={15} />}{label}</button>
    {task && <p className="chat-muted" style={{ maxWidth: 400 }}>{t('可在设置中的“下载管理”查看进度。')}</p>}
    {(error || task?.message) && <p role="status" className="chat-muted" style={{ maxWidth: 400 }}>
      {t(error || task?.message || '')}</p>}
  </div>;
}

function DirectDownload({ path, context }: Props) {
  const download = useFileDownload({ ...context, path, target: browserDownloadTarget,
    prepare: () => prepareBrowserDownload(path), success: t('文件已交给浏览器保存') });
  return <div><button type="button" className="chat-button"
    disabled={!download.busy && (!context.ready || !context.threadId)}
    onClick={download.busy ? download.cancel : download.start}><Download size={15} />
    {download.busy ? t('取消下载 · {percent}%', { percent: download.percent }) : t('下载')}</button>
    {download.busy && !!download.detail && <p className="chat-muted" style={{ maxWidth: 400 }}>{download.detail}</p>}
    {!!download.message && <p role="status" className="chat-muted" style={{ maxWidth: 400 }}>{t(download.message)}</p>}
  </div>;
}
