import { useState } from 'react';
import { GitBranch, ChevronDown, RefreshCw, X } from 'lucide-react';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { GIT_ACTIONS } from '../../../../../shared/remote-chat/gitActions';
import type { GitAction } from '../../../../../shared/remote-chat/gitTypes';
import { t } from '../../i18n';

export function GitToolbar({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const [menu, setMenu] = useState<'branches' | 'actions' | null>(null);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Exclude<GitAction, 'switch'>>('update');
  const disabled = panel.busy || !connected || !panel.changes;
  const repository = panel.repository;
  const run = () => { setMenu(null); void panel.action(action); };
  return <>
    <div className="git-toolbar">
      <button className="git-branch" type="button" aria-label={t('切换分支')} disabled={disabled}
        aria-expanded={menu === 'branches'} onClick={() => setMenu(menu === 'branches' ? null : 'branches')}>
        <GitBranch size={16} /><span>{panel.changes?.branch ?? t('分离的 HEAD')}</span><ChevronDown size={14} />
      </button>
      <button type="button" aria-expanded={menu === 'actions'} disabled={disabled}
        onClick={() => setMenu(menu === 'actions' ? null : 'actions')}>{t('同步')}</button>
      <button type="button" aria-label={t('刷新 Git')} disabled={disabled}
        onClick={() => { panel.setDetail(null); void panel.refresh(); }}><RefreshCw size={18} /></button>
    </div>
    {repository?.upstream && <div className="git-tracking">{repository.upstream}
      <span>↑ {repository.ahead} · ↓ {repository.behind}</span></div>}
    {menu && <div className="git-menu" role="region" aria-label={t(menu === 'branches' ? '切换分支' : '同步项目')}>
      <div className="git-menu-heading"><strong>{t(menu === 'branches' ? '切换分支' : '同步项目')}</strong>
        <button type="button" aria-label={t('关闭菜单')} onClick={() => setMenu(null)}><X size={16} /></button></div>
      {menu === 'branches' ? <>
        <input aria-label={t('搜索分支')} placeholder={t('搜索分支')} value={query}
          onChange={event => setQuery(event.target.value)} />
        <div className="git-branch-list">{repository?.branches.filter(branch => branch.name.includes(query))
          .map(branch => <button key={branch.ref} type="button"
            disabled={disabled || branch.occupied || (!branch.remote && branch.name === panel.changes?.branch)}
            onClick={() => { setMenu(null); void panel.action('switch', branch.ref); }}>
            <span>{branch.name}</span><small>{t(branch.occupied ? '其他工作树使用中' : branch.remote ? '远程' : '本地')}
              {!branch.remote && branch.name === panel.changes?.branch ? ' ✓' : ''}</small></button>)}</div>
        <p>{t('选择远程分支会创建同名本地分支。')}</p>
      </> : <>
        <div className="git-action-options">{GIT_ACTIONS.map(item => <button type="button" key={item.action}
          aria-pressed={action === item.action} onClick={() => setAction(item.action)}>{t(item.label)}</button>)}</div>
        <p>{t(GIT_ACTIONS.find(item => item.action === action)!.hint)}</p>
        <p>{t('当前分支')}：{panel.changes?.branch ?? 'HEAD'}<br />
          {t('跟踪分支')}：{repository?.upstream ?? t('未设置')}</p>
        {action === 'pull' && <>
          <label className="git-strategy">{t('整合方式')}<select aria-label={t('整合方式')} value={panel.strategy}
            onChange={event => panel.setStrategy(event.target.value === 'rebase' ? 'rebase' : 'merge')}>
            <option value="merge">{t('合并 Merge')}</option><option value="rebase">{t('变基 Rebase')}</option>
          </select></label>
        </>}
        {(action === 'pull' || action === 'update') && !!panel.changes?.files.length
          && <p>{t('请先提交本地改动，再拉取或更新项目。')}</p>}
        {!repository?.remotes.length && <p>{t('项目还没有远程仓库，请先在电脑上添加。')}</p>}
        <button type="button" className="git-submit" disabled={disabled || !repository?.remotes.length
          || (action !== 'fetch' && !repository.upstream)
          || ((action === 'pull' || action === 'update') && !!panel.changes?.files.length)} onClick={run}>
          {t('执行 {action}', { action: t(GIT_ACTIONS.find(item => item.action === action)!.label) })}</button>
      </>}
    </div>}
  </>;
}
