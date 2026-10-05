import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import type { DownloadTask } from './types';

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
const STATUS = { queued: '等待下载', preparing: '准备并校验文件', downloading: '下载中', verifying: '正在校验',
  ready: '文件已就绪', saving: '正在保存', paused: '已暂停', completed: '已完成', failed: '下载失败' };

export function DownloadCard({ task, busy, connected, action, remove }: {
  task: DownloadTask; busy: boolean; connected: boolean; action: () => void; remove: () => void;
}) {
  const running = ['downloading', 'queued', 'preparing', 'verifying'].includes(task.status);
  const completed = ['completed', 'ready', 'saving'].includes(task.status);
  const label = completed ? '保存到设备' : running ? '暂停' : '继续下载';
  const Icon = completed ? Download : running ? Pause : Play;
  const percent = task.size ? Math.round(task.received / task.size * 100) : completed ? 100 : 0;
  return <article className="download-card" aria-label={task.name}>
    <div className="download-task-heading"><strong>{task.name}</strong><span>{t(STATUS[task.status])}</span></div>
    <p className="download-path">{task.source.deviceName} · {task.source.path}</p>
    <progress max={100} value={percent} aria-label={t('下载进度：{name}', { name: task.name })} />
    <div className="download-task-meta"><span>{formatBytes(task.received)} / {formatBytes(task.size)}</span>
      {task.status === 'downloading' && !!task.bytesPerSecond && <span>{formatBytes(task.bytesPerSecond)}/s</span>}
    </div>
    {task.message && <p role="status" className="download-notice">{t(task.message)}</p>}
    {!connected && !completed && <p className="download-notice">{t('连接原来的电脑后可继续下载。')}</p>}
    <div className="download-actions">
      <button type="button" className="download-button" onClick={action}
        disabled={busy || task.status === 'saving' || (!running && !completed && !connected)}>
        <Icon size={17} />{t(label)}</button>
      <button type="button" className="download-button download-danger" disabled={busy} onClick={remove}>
        <Trash2 size={17} />{t('删除')}</button>
    </div>
  </article>;
}
