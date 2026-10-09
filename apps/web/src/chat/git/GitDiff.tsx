import { useContext, useEffect, useId, useMemo } from 'react';
import { Spin } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { parseDiff, type DiffFile } from '../../../../../shared/chat/diff';
import type { GitClient, GitDiff as GitDiffValue } from '../../../../../shared/remote-chat/gitTypes';
import { useGitDiff, type GitDetail } from '../../../../../shared/remote-chat/useRemoteGit';
import { DetailsContext } from '../../../../desktop/src/pages/codexGui/detailsContext';
import { t } from '../../i18n';

type DiffDetail = Extract<GitDetail, { kind: 'diff' }>;
interface Props {
  client: GitClient; cwd: string; detail: DiffDetail; enabled: boolean; desktop: boolean; onBack: () => void;
}

/** Use the file review workspace so Git and conversation changes share every diff interaction. */
function GitDiffPreview({ value, detail }: { value: GitDiffValue; detail: DiffDetail }) {
  const panel = useContext(DetailsContext);
  const id = useId();
  const entry = useMemo(() => {
    const parsed = parseDiff(value.text);
    const empty: DiffFile = { path: detail.path, kind: 'update', raw: value.text, lines: [], added: 0, removed: 0 };
    return { id, files: parsed.length ? parsed : [empty],
      title: detail.commit ? `Git · ${detail.commit.hash.slice(0, 8)}` : 'Git',
      status: value.truncated ? '差异较大，仅显示部分内容。' : undefined };
  }, [id, detail.path, detail.commit?.hash, value]);
  const open = panel?.open;
  const close = panel?.close;
  const setConversationChanges = panel?.setConversationChanges;
  useEffect(() => {
    setConversationChanges?.(entry);
    open?.(entry);
    return close;
  }, [entry, open, close, setConversationChanges]);
  return null;
}

export function GitDiff({ client, cwd, detail, enabled, desktop, onBack }: Props) {
  const diff = useGitDiff(client, cwd, detail, enabled);
  return <>
    {!desktop && <button type="button" className="git-detail-title" onClick={onBack}
      aria-label={detail.commit ? t('返回文件列表') : undefined}>
      <ArrowLeft size={18} /><span>{detail.title}</span></button>}
    {diff.error && <p role="alert" className="git-error">{t(diff.error)}</p>}
    {!diff.value && !diff.error && enabled && <div className="git-loading"><Spin /></div>}
    {diff.value && (desktop ? <GitDiffPreview value={diff.value} detail={detail} />
      : <div className="git-diff-scroll">
        {diff.value.truncated && <p className="git-notice">{t('差异较大，仅显示部分内容。')}</p>}
        <pre className="git-diff">{diff.value.text ? diff.value.text.split('\n').map((line, index) =>
          <span key={index} data-kind={line[0]}>{line}{'\n'}</span>) : t('没有可显示的文本差异。')}</pre>
      </div>)}
  </>;
}
