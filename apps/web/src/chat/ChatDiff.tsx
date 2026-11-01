import { t, useLanguage } from '../i18n';
import { DeferredDetails } from '../../../../shared/chat/DeferredDetails';
import { useContext } from 'react';
import { ChevronDown, FileText, Folder } from 'lucide-react';
import type { DiffFile, DiffLine } from '../../../../shared/chat/diff';
import { groupDiffFiles } from '../../../../shared/chat/diffGroups';
import { ChatCopyButton } from './ChatCopyButton';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatFilesSummary } from './ChatFilesSummary';
import { useDiffAutoLoad } from '../../../../shared/chat/useDiffAutoLoad';

const PAGE_LINES = 160;
function DiffContent({ file, onComment }: { file: DiffFile; onComment?: (file: DiffFile, line: DiffLine) => void }) {
  useLanguage();
  const { limit, loadMore, endRef, onScroll } = useDiffAutoLoad(file.lines.length, PAGE_LINES);
  return <div className="chat-diff-content">
    <ChatCopyButton text={file.raw} label={t("client.chat.copyDiff.c90ddd")} />
    <pre tabIndex={0} onScroll={onScroll}>{file.lines.slice(0, limit).map((line, index) =>
      <span className={`chat-diff-line ${line.kind}`} key={index}>
        {onComment && (line.oldLine || line.newLine) && <button type="button" className="chat-diff-comment"
          aria-label={t("client.taskReview.commentOnLine", { value1: line.newLine ?? line.oldLine ?? 0 })}
          onClick={() => onComment(file, line)}>{t("client.taskReview.comment")}</button>}
        <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span>
        <code>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}{line.text}{'\n'}</code>
      </span>)}
      {limit < file.lines.length && <span ref={endRef} aria-hidden
        style={{ display: 'block', position: 'sticky', left: 0, width: 1, height: 1 }} />}
    </pre>
    {limit < file.lines.length && <button type="button" className="chat-text-action"
      onClick={loadMore}>{t("client.chat.showMoreChanges")}</button>}
  </div>;
}

export function ChatDiff({ files, status, onComment }: {
  files: readonly DiffFile[]; status?: string; onComment?: (file: DiffFile, line: DiffLine) => void;
}) {
  useLanguage();
  const panel = useContext(DetailsContext);
  if (panel && !onComment) return <ChatFilesSummary files={files} title="client.chat.fileChanges" status={status} />;
  return <div className="chat-diff">{groupDiffFiles(files).map(group =>
    <section key={group.directory}><h3><Folder size={17} />
      {group.directory.split('/').pop() ? group.name : t("client.runtimeErrors.rootFolder")}</h3>
      <p className="chat-diff-folder">{group.directory || '.'}</p>
      {group.entries.map(({ file, index }) => <DeferredDetails key={index} className="chat-diff-file"
        summary={<summary><FileText size={16} /><span title={file.path}>{file.path.split(/[\\/]/).at(-1)}</span>
          <b className="chat-added">+{file.added}</b><b className="chat-removed">−{file.removed}</b>
          <ChevronDown size={15} /></summary>}>
        {() => <>{file.previousPath && <p className="chat-muted">{t("client.chat.originalPath")}{file.previousPath}</p>}
          <DiffContent file={file} onComment={onComment} /></>}
      </DeferredDetails>)}
    </section>)}</div>;
}
