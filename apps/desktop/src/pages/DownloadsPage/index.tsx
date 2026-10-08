import { useState } from 'react';
import { Download } from 'lucide-react';
import { Modal, Segmented } from 'antd';
import { DownloadCard } from '../../../../web/src/downloads/DownloadCard';
import { downloadManager } from '../../../../web/src/downloads/manager';
import { useDownloadTasks } from '../../../../web/src/downloads/useDownloadTasks';
import { desktopDownloadOwner } from '../../downloads/useDesktopDownloads';
import { guiText } from '../../i18n/guiText';
import { useGuiLanguage } from '../../i18n/useGuiLanguage';
import type { CloudAuthState } from '../../types';
import '../../../../web/src/downloads/styles.css';
import styles from './index.module.less';

type Filter = 'all' | 'active' | 'ready';
const READY_STATUSES = new Set(['ready', 'saving', 'completed']);

function confirmRemove() {
  return new Promise<boolean>(resolve => {
    Modal.confirm({ title: guiText('删除下载？'), width: 400,
      content: guiText('将删除此下载任务和临时文件，已保存的文件会保留。'),
      okText: guiText('删除'), cancelText: guiText('保留'), okButtonProps: { danger: true },
      onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
      afterClose: () => resolve(false) });
  });
}

export function DownloadsPage({ auth }: { auth: CloudAuthState }) {
  useGuiLanguage();
  const owner = auth.authenticated && auth.baseUrl && auth.userId
    ? desktopDownloadOwner({ baseUrl: auth.baseUrl, userId: auth.userId }) : '';
  const { tasks, busy, error, run } = useDownloadTasks(owner, confirmRemove);
  const [filter, setFilter] = useState<Filter>('all');
  const ready = tasks.filter(task => READY_STATUSES.has(task.status)).length;
  const visible = tasks.filter(task => filter === 'all' || READY_STATUSES.has(task.status) === (filter === 'ready'));
  return <section className={styles.page} aria-label={guiText('下载管理')}>
    <header className={`topbar ${styles.header}`} data-tauri-drag-region>
      <div><span className="eyebrow">DOWNLOADS</span><h1>{guiText('下载管理')}</h1></div>
      <span className={styles.total}>{guiText('{count} 个任务', { count: tasks.length })}</span>
    </header>
    <div className={styles.content}>
      <div className={styles.toolbar}><Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: guiText('全部') },
        { value: 'active', label: `${guiText('未完成')} · ${tasks.length - ready}` },
        { value: 'ready', label: `${guiText('已就绪')} · ${ready}` },
      ]} />
        <p>{guiText('切换页面后下载会继续，文件就绪后可保存到设备。')}</p>
      </div>
      {error && <p role="alert" className={styles.notice}>{guiText(error)}</p>}
      <div className={styles.tasks}>{visible.map(task => <DownloadCard key={task.id} task={task}
        busy={busy === task.id} connected={!!downloadManager.connectionForSource(task.source)?.ready}
        action={() => { void run(task); }} remove={() => { void run(task, true); }} text={guiText} />)}</div>
      {!visible.length && <div className={styles.empty}><Download size={36} strokeWidth={1.5} />
        <h2>{guiText(tasks.length ? '没有符合条件的下载任务' : '还没有下载任务')}</h2>
        <p>{guiText('在聊天中打开文件并点击下载，任务会显示在这里。')}</p></div>}
    </div>
  </section>;
}
