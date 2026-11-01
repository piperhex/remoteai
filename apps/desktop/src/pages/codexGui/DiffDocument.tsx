import { memo, useMemo, useState } from "react";
import { ChevronDown, FileDiff, Folder } from "lucide-react";
import type { DiffFile, DiffLine } from "./diff";
import { pairDiffLines } from "./diff";
import { CopyButton } from "./CopyButton";
import { useDiffText } from "../../../../../shared/chat/diffText";
import { groupDiffFiles } from "../../../../../shared/chat/diffGroups";
import { useDiffAutoLoad } from "../../../../../shared/chat/useDiffAutoLoad";
import { fileLanguage, HighlightedCode } from "./CodeHighlight";
import styles from "./DiffView.module.less";

const KIND_LABELS: Record<string, string> = { add: "client.git.added", delete: "client.projectBrowser.deleted", update: "client.git.modified" };
const REDUNDANT_DIFF_HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode )/;

function Counts({ added, removed }: { added: number; removed: number }) {
  const t = useDiffText();
  return <span className={styles.counts} aria-label={t("client.chat.linesAddedLinesRemoved", { added, removed })}>
    <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
  </span>;
}

function UnifiedLine({ line, language }: { line: DiffLine; language: string }) {
  const sign = { add: "+", remove: "−", context: " ", hunk: " ", meta: " " }[line.kind];
  return <div className={`${styles.line} ${styles[line.kind]}`}>
    <span className={styles.number}>{line.oldLine}</span><span className={styles.number}>{line.newLine}</span>
    <span className={styles.sign} aria-hidden="true">{sign}</span>
    <HighlightedCode text={line.text || " "} language={line.kind === "hunk" || line.kind === "meta" ? "" : language} />
  </div>;
}

function SplitCell({ line, side, language }: { line?: DiffLine; side: "left" | "right"; language: string }) {
  return <div className={`${styles.cell} ${line ? styles[line.kind] : styles.empty}`}>
    <span className={styles.number}>{side === "left" ? line?.oldLine : line?.newLine}</span>
    <HighlightedCode text={line?.text || " "} language={language} />
  </div>;
}

function DiffContent({ file, split }: { file: DiffFile; split: boolean }) {
  const t = useDiffText();
  const lines = useMemo(() => file.lines.filter((line) => line.kind !== "meta"
    || !REDUNDANT_DIFF_HEADER.test(line.text)), [file.lines]);
  const pairs = useMemo(() => split ? pairDiffLines(lines) : [], [lines, split]);
  const language = fileLanguage(file.path);
  const total = split ? pairs.length : lines.length;
  const { limit, loadMore, endRef, onScroll } = useDiffAutoLoad(total);
  return <>
    <div className={styles.fileToolbar}>
      <span>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
      <CopyButton text={file.raw} label={t("client.chat.copyDiff")} />
    </div>
    {total ? <div className={styles.codeScroll} tabIndex={0} onScroll={onScroll}
      aria-label={t("client.chat.codeDiffFor", { path: file.path })}>
      {split ? <div className={styles.split}>
        <div className={styles.splitLabels}><span>{t("client.chat.before")}</span><span>{t("client.chat.after")}</span></div>
        {pairs.slice(0, limit).map((pair, index) => pair.heading
          ? <div key={index} className={styles[pair.heading.kind]}><code>{pair.heading.text}</code></div>
          : <div key={index} className={styles.pair}>
            <SplitCell line={pair.left} side="left" language={language} />
            <SplitCell line={pair.right} side="right" language={language} />
          </div>)}
      </div> : lines.slice(0, limit).map((line, index) => <UnifiedLine line={line} language={language} key={index} />)}
      {limit < total && <span ref={endRef} aria-hidden
        style={{ display: 'block', position: 'sticky', left: 0, width: 1, height: 1 }} />}
    </div> : <p className={styles.notice}>{t(file.kind === "add" ? "client.chat.newEmptyFile" : "client.chat.noTextDiffIsAvailableForThisFile")}</p>}
    {limit < total && <button className={styles.more} onClick={loadMore}>
      {t("client.chat.showMoreLinesRemaining", { count: total - limit })}</button>}
  </>;
}

const FileCard = memo(function FileCard({ file, split, initialOpen }: {
  file: DiffFile; split: boolean; initialOpen: boolean;
}) {
  const t = useDiffText();
  const [open, setOpen] = useState(initialOpen);
  const label = file.previousPath ? "client.projectBrowser.renamed" : KIND_LABELS[file.kind] ?? "client.git.modified";
  return <section className={styles.file}>
    <button className={styles.fileHeader} aria-expanded={open} onClick={() => setOpen(!open)}>
      <FileDiff size={15} /><span className={styles.path}>{file.path.split(/[\\/]/).pop()}</span>
      <span className={styles.kind}>{t(label)}</span><Counts added={file.added} removed={file.removed} />
      <ChevronDown size={14} className={open ? styles.rotated : undefined} />
    </button>
    {open && <DiffContent file={file} split={split} />}
  </section>;
});

export interface DiffDocumentProps {
  files: readonly DiffFile[]; title?: string; status?: string; initialOpen?: boolean; continuous?: boolean;
  filePath?: string;
}

export const DiffDocument = memo(function DiffDocument({ files: allFiles, title = "client.shared.fileChanges", status,
  initialOpen = false, continuous = false, filePath }: DiffDocumentProps) {
  const t = useDiffText();
  const [split, setSplit] = useState(false);
  const files = filePath === undefined ? allFiles : allFiles.filter((file) => file.path === filePath);
  if (!files.length) return null;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const fileCount = new Set(files.map((file) => file.path)).size;
  return <div className={`${styles.diff} ${continuous ? styles.continuous : ""}`}>
    <div className={styles.toolbar}><strong>{t(title)}</strong><span>{t("client.chat.files", { count: fileCount })}</span>
      <Counts added={added} removed={removed} />
      {status && <span role="status">{t(status)}</span>}
      <div className={styles.modes} role="group" aria-label={t("client.chat.diffDisplayMode")}>
        <button aria-pressed={!split} onClick={() => setSplit(false)}>{t("client.chat.unified")}</button>
        <button aria-pressed={split} onClick={() => setSplit(true)}>{t("client.chat.sideBySide")}</button>
      </div>
    </div>
    {groupDiffFiles(files).map((group) => <section key={group.directory} className={styles.folderGroup}
      aria-label={group.directory || t("client.runtimeErrors.rootFolder")}>
      <header className={styles.folderHeader}>
        <Folder size={16} aria-hidden="true" />
        <div className={styles.folderInfo}>
          <h3 className={styles.folderName}>
            {group.directory && group.directory !== "/" ? group.name : t("client.runtimeErrors.rootFolder")}</h3>
          <p className={styles.folderPath}>{group.directory || "."}</p>
        </div>
      </header>
      {group.entries.map(({ file, index }) => <FileCard key={`${file.path}:${index}`} file={file} split={split}
        initialOpen={initialOpen && (filePath !== undefined || index === 0)} />)}
    </section>)}
  </div>;
});
