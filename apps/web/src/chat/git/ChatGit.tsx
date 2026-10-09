import { Drawer, Spin } from 'antd';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import { parentGitDetail, useRemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { useGitCommitFiles } from '../../../../../shared/remote-chat/useGitCommitFiles';
import { GitHistory } from './GitHistory';
import { GitChanges } from './GitChanges';
import { GitCommitFiles } from './GitCommitFiles';
import { GitToolbar } from './GitToolbar';
import { GitDiff } from './GitDiff';
import { ChatDetailsWorkspace } from '../ChatDetailsWorkspace';
import { useDesktopLayout } from '../../useDesktopLayout';
import { t } from '../../i18n';

interface Props {
  client: GitClient; cwd: string; connected: boolean; active: boolean; deviceName?: string; onClose: () => void;
  desktopDiffs?: boolean;
}

export function ChatGit(props: Props) {
  const panel = useRemoteGit(props);
  const detail = props.desktopDiffs && panel.detail?.kind === 'diff' ? parentGitDetail(panel.detail) : panel.detail;
  const commitFiles = useGitCommitFiles(props.client, props.cwd, detail?.commit?.hash, props.active && props.connected);
  const desktop = useDesktopLayout();
  return <Drawer open={props.active} title="Git" placement={desktop ? 'right' : 'bottom'}
    height="90%" width={desktop ? '80%' : undefined} onClose={props.onClose}
    rootClassName="chat-terminal-drawer chat-git-drawer" closable={{ 'aria-label': t('关闭 Git'), placement: 'end' }}
    extra={<span className="chat-terminal-device">{props.deviceName}</span>}>
    <ChatDetailsWorkspace selected={props.cwd} active={props.active} enabled={Boolean(props.desktopDiffs)}>
    <div className="chat-git">
      <GitToolbar panel={panel} connected={props.connected} />
      <div className="git-project" title={panel.changes?.root ?? props.cwd}>{panel.changes?.root ?? props.cwd}</div>
      {!props.cwd && <p className="git-notice">{t('请先选择一个项目。')}</p>}
      {!props.connected && <p className="git-notice">{t('电脑连接后即可使用 Git。')}</p>}
      {panel.error && <p role="alert" className="git-error">{t(panel.error)}</p>}
      {panel.changes?.files.some(file => file.conflict) && <p className="git-error">
        {t('请先在电脑上解决冲突或完成正在进行的合并。')}</p>}
      {panel.notice && <p role="status" className="git-notice">{panel.notice.startsWith('已提交 ')
        ? t('已提交 {hash}', { hash: panel.notice.slice(4) }) : t(panel.notice)}</p>}
      {panel.busy && <div className="git-loading"><Spin size="small" />{t('正在处理…')}</div>}
      {panel.detail?.kind === 'diff' && <GitDiff
        key={JSON.stringify([props.cwd, panel.detail.path, panel.detail.commit?.hash])}
        client={props.client} cwd={props.cwd} detail={panel.detail} enabled={props.active && props.connected}
        desktop={Boolean(props.desktopDiffs)} onBack={panel.backDetail} />}
      {detail?.kind === 'files' && <GitCommitFiles commit={detail.commit} state={commitFiles}
        connected={props.connected} onBack={() => panel.setDetail(parentGitDetail(detail))}
        onSelect={file => panel.setDetail({ kind: 'diff', path: file.path, commit: detail.commit,
          title: `${file.path} · ${detail.commit.hash.slice(0, 8)}` })} />}
      {!detail && <>
        <div className="git-tabs" role="tablist" aria-label={t('Git 视图')}>
          <button type="button" role="tab" aria-selected={panel.tab === 'changes'}
            onClick={() => { panel.setDetail(null); panel.setTab('changes'); }}>
            {t('改动')} {panel.changes?.files.length ?? 0}</button>
          <button type="button" role="tab" aria-selected={panel.tab === 'history'}
            onClick={() => { panel.setDetail(null); panel.setTab('history'); }}>
            {t('提交记录')}</button></div>
        {panel.tab === 'changes' ? <GitChanges panel={panel} connected={props.connected} />
          : <GitHistory panel={panel} connected={props.connected} />}
      </>}
    </div>
    </ChatDetailsWorkspace>
  </Drawer>;
}
