import { Checkbox } from 'antd';
import { ChevronDown, ChevronRight } from 'lucide-react';
import fileIcon from '../../../../../shared/remote-chat/assets/git-icons/file-v2.png';
import folderIcon from '../../../../../shared/remote-chat/assets/git-icons/folder-v2.png';
import { selectionState } from '../../../../../shared/remote-chat/gitFiles';
import type { GitFileRow } from '../../../../../shared/remote-chat/useGitFileList';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { gitAreaColors } from './gitTheme';
import { t } from '../../i18n';

export function GitChanges({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const files = panel.changes?.files ?? [];
  const list = panel.fileList;
  const count = Object.keys(panel.selected).length;
  const all = selectionState(files, panel.selected);
  return <>
    <div className="git-selection"><Checkbox disabled={panel.busy || !files.some(file => !file.conflict)}
      checked={all === true} indeterminate={all === 'mixed'} onChange={panel.selectAll}>{t('全选')}</Checkbox>
      <span>{t('已选 {count} 个文件', { count })}</span>
      <div className="git-view-toggle" aria-label={t('文件显示方式')}>
        {(['tree', 'flat'] as const).map(mode => <button key={mode} type="button" aria-pressed={list.mode === mode}
          onClick={() => list.setMode(mode)}>{t(mode === 'tree' ? '文件夹' : '平铺')}</button>)}
      </div></div>
    <div className="git-files">
      {panel.changes && !files.length && <p className="git-notice">{t('工作区没有未提交的改动。')}</p>}
      {list.rows.map(row => <GitRow key={row.id} row={row} panel={panel} connected={connected}
        onToggle={() => list.toggleFolder(row.id)} flat={list.mode === 'flat'} />)}
    </div>
    <div className="git-commit-form"><textarea aria-label={t('提交说明')} placeholder={t('填写提交说明')}
      maxLength={4000} value={panel.message} disabled={panel.busy}
      onChange={event => panel.setMessage(event.target.value)} />
      <p>{t('提交所选文件的全部改动，包含已暂存和未暂存的内容。')}</p>
      <button type="button" className="git-submit" disabled={!panel.canCommit} onClick={() => void panel.commit()}>
        {t('提交 {count} 个文件', { count })}</button></div>
  </>;
}

function GitRow({ row, panel, connected, onToggle, flat }: {
  row: GitFileRow; panel: RemoteGit; connected: boolean; onToggle: () => void; flat: boolean;
}) {
  const checked = selectionState(row.files, panel.selected);
  const folder = row.kind === 'folder';
  const area = row.kind === 'area';
  const colors = gitAreaColors(row.area.id);
  return <div className={`git-file git-file-${row.kind}`} data-area={row.area.id}
    style={{ color: colors.color, background: !area && checked === true ? colors.background : undefined }}>
    <Checkbox aria-label={t('选择 {path}', { path: row.path })} checked={checked === true}
      indeterminate={checked === 'mixed'} disabled={panel.busy || !row.files.some(file => !file.conflict)}
      onChange={() => panel.selectFiles(row.files)} />
    {area ? <strong><i className="git-area-dot" style={{ background: colors.color }} />
      {t(row.name)} <small style={{ background: colors.background }}>{row.files.length}</small></strong>
      : <button type="button" aria-label={folder ? t('展开或收起 {path}', { path: row.path })
        : t('查看 {path}', { path: row.path })} aria-expanded={folder ? !row.collapsed : undefined}
        disabled={panel.busy || (!folder && !connected)} title={row.path}
        style={{ marginLeft: Math.min(row.depth, 4) * 14 }}
        onClick={() => folder ? onToggle() : panel.setDetail({ kind: 'diff', path: row.path, title: row.path })}>
        {!flat && <span className="git-tree-chevron">{folder && (row.collapsed
          ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}</span>}
        <img src={folder ? folderIcon : fileIcon} className="git-tree-icon" alt="" aria-hidden="true" />
        <span className="git-file-name">{row.name}
          {flat && row.path !== row.name && <small>{row.path}</small>}
          {row.file?.originalPath && <small>{row.file.originalPath} → {row.path}</small>}</span>
        <span className="git-status" style={{ background: folder ? undefined : colors.background }}>
          {folder ? row.files.length : row.file?.status.trim()}</span>
      </button>}
  </div>;
}
