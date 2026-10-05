import { useState } from 'react';
import { ArrowLeft, Download, Folder, Monitor } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { downloadConnectionLabel } from '../../../../shared/remote-chat/downloadConnection';
import { DownloadBrowser } from './DownloadBrowser';
import { DownloadCard } from './DownloadCard';
import { useDownloadTasks } from './useDownloadTasks';
import './styles.css';

export function DownloadManagerPage({ owner, onBack }: { owner: string; onBack: () => void }) {
  useLanguage();
  const { connection, tasks, error, busy, run } = useDownloadTasks(owner);
  const [view, setView] = useState<'tasks' | 'project' | 'computer'>('tasks');
  if (view !== 'tasks' && connection) return <DownloadBrowser
    key={`${connection.deviceId}:${view}:${connection.threadId ?? connection.cwd ?? ''}`}
    connection={connection} scope={view} back={() => setView('tasks')} />;
  return <section className="downloads-page">
    <header className="downloads-header"><button type="button" className="download-icon-button"
      aria-label={t('返回设置')} onClick={onBack}><ArrowLeft size={22} /></button><h2>{t('下载管理')}</h2></header>
    <div className="download-sources">
      <button type="button" className="download-card" disabled={!connection?.ready || !(connection.threadId || connection.cwd)}
        onClick={() => setView('project')}><Folder size={24} /><strong>{t('当前项目')}</strong></button>
      <button type="button" className="download-card" disabled={!connection?.ready}
        onClick={() => setView('computer')}><Monitor size={24} /><strong>{t('此电脑')}</strong></button>
    </div>
    <p className="download-help">{connection?.deviceName || t('先在聊天中连接电脑，即可浏览文件。')}
      {connection && <span role="status"> · {t(downloadConnectionLabel(connection.mode))}</span>}</p>
    <p className="download-help">{t('切换页面后下载会继续。关闭网页会暂停，重新打开后可继续下载。文件就绪后点击“保存到设备”。')}</p>
    {error && <p role="alert" className="download-notice">{t(error)}</p>}
    <h3>{t('下载任务')} <small>{tasks.length}</small></h3>
    <div className="download-tasks">{tasks.map(task => <DownloadCard key={task.id} task={task} busy={busy === task.id}
      connected={!!connection?.ready && connection.deviceId === task.source.deviceId}
      action={() => { void run(task); }} remove={() => { void run(task, true); }} />)}</div>
    {!tasks.length && <div className="download-empty"><Download size={38} /><h3>{t('还没有下载任务')}</h3>
      <p>{t('从上方浏览文件，或在聊天的文件预览中点击下载。')}</p></div>}
  </section>;
}
