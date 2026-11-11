import { Modal } from 'antd';
import { isTauri } from '@tauri-apps/api/core';
import { DownloadWorkspace } from '../../../../../shared/downloads/desktop/DownloadWorkspace';
import { useDownloadTasks } from '../../../../../shared/downloads/useDownloadTasks';
import { authenticatedDownloadOwner } from '../../downloads/useDesktopDownloads';
import { openDesktopDownload, revealDesktopDownload } from '../../downloads/openDownload';
import { LOCAL_DOWNLOAD_OWNER, useLocalGitDownloads } from '../../downloads/localGitDownloads';
import { displayText, uiText } from '../../../../../shared/localization/uiText';
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import type { CloudAuthState } from '../../types';
import { useGuiComputers } from '../codexGui/remote/useGuiComputers';
import { useDesktopSyncHosts } from '../codexGui/syncHosts';
import '../../../../../shared/downloads/styles.css';
import styles from './index.module.less';

function confirmRemove(count?: number) {
  return new Promise<boolean>(resolve => {
    Modal.confirm({ title: count === undefined ? uiText('client.downloads.deleteDownload')
      : uiText('client.downloads.deleteSelectedTitle', { count }), width: 400,
      content: uiText('client.downloads.removeThisTaskAndItsTemporaryFilesFilesYouHave'),
      okText: uiText('client.projectBrowser.deleted'), cancelText: uiText('client.downloads.keep'),
      okButtonProps: { danger: true },
      onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
      afterClose: () => resolve(false) });
  });
}

export function DownloadsPage({ auth }: { auth: CloudAuthState }) {
  useGuiLanguage();
  useLocalGitDownloads();
  const computers = useGuiComputers({ active: true, login: () => {},
    identity: auth.authenticated && auth.baseUrl && auth.userId
      ? { baseUrl: auth.baseUrl, userId: auth.userId } : null });
  useDesktopSyncHosts(computers);
  const owner = authenticatedDownloadOwner(auth);
  const { tasks, busy, error, run, removeTasks } = useDownloadTasks(owner, {
    confirmRemove, openDownload: openDesktopDownload, additionalOwner: LOCAL_DOWNLOAD_OWNER,
    revealDownload: isTauri() ? revealDesktopDownload : undefined,
  });
  return <div className={styles.page}>
    <DownloadWorkspace tasks={tasks} owner={owner} busy={!!busy} error={error} text={displayText}
      run={run} removeTasks={removeTasks} allowReveal={isTauri()} />
  </div>;
}
