import { useId, useState, type ReactNode } from "react";
import { ChevronDown, FileDiff } from "lucide-react";
import type { DiffFile } from "./diff";
import { summarizeDiffFiles } from "../../../../../shared/chat/diffSummary";
import { useDiffText } from "../../../../../shared/chat/diffText";
import styles from "./EditedFilesSummary.module.less";

const COLLAPSED_FILE_COUNT = 3;
const UNAPPLIED_STATUSES = [
  'client.chat.notApplied', 'client.chat.editFailed', 'client.chat.editing', 'client.chat.reverted',
] as const;

function Counts({ added, removed }: { added: number; removed: number }) {
  const t = useDiffText();
  return <span className={styles.counts} aria-label={t("client.chat.linesAddedLinesRemoved", { added, removed })}>
    <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
  </span>;
}

export function EditedFilesSummary({ files, title, status, onReview, onReviewFile, undo, beforeReview, renderFile }: {
  files: readonly DiffFile[]; title: string; status?: string; onReview: () => void;
  onReviewFile: (path: string) => void;
  undo?: ReactNode;
  beforeReview?: ReactNode;
  renderFile?: (props: { path: string; className: string; onReview: () => void }) => ReactNode;
}) {
  const t = useDiffText();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { files: summary, added, removed } = summarizeDiffFiles(files);
  const changed = !UNAPPLIED_STATUSES.some(key => status === key || status === t(key));
  const hiddenCount = summary.length - COLLAPSED_FILE_COUNT;
  const visibleFiles = expanded ? summary : summary.slice(0, COLLAPSED_FILE_COUNT);
  return <section className={styles.card} aria-label={t(title)}>
    <header className={styles.header}>
      <span className={styles.icon}><FileDiff size={21} aria-hidden="true" /></span>
      <div className={styles.overview}>
        <strong>{t(changed ? "client.chat.edited" : status ?? "client.chat.edited")} {t("client.chat.files", { count: summary.length })}</strong>
        <Counts added={added} removed={removed} />
      </div>
      {undo}{beforeReview}<button type="button" className={styles.review} onClick={onReview}
        aria-label={t("client.chat.viewFilesLinesAddedLinesRemoved",
          { title: t(title), count: summary.length, added, removed })}>{t("client.chat.review")}</button>
    </header>
    <ul className={styles.files} id={listId}>
      {visibleFiles.map((file) => <li key={file.path}>
        {renderFile ? renderFile({ path: file.path, className: styles.path, onReview: () => onReviewFile(file.path) })
          : <button type="button" className={styles.path} onClick={() => onReviewFile(file.path)}
            aria-label={t("client.chat.viewDiffFor", { path: file.path })}>{file.path}</button>}
        <Counts added={file.added} removed={file.removed} />
      </li>)}
    </ul>
    {hiddenCount > 0 && <button type="button" className={styles.toggle} aria-expanded={expanded}
      aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? t("client.chat.collapseFileList") : t("client.chat.showMoreFiles", { count: hiddenCount })}
      <ChevronDown size={16} className={expanded ? styles.rotated : undefined} aria-hidden="true" />
    </button>}
  </section>;
}
