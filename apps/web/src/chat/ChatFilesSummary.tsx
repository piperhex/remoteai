import { useContext, useId, useMemo, type ReactNode } from 'react';
import { FileEnvironmentContext } from '../../../desktop/src/pages/codexGui/fileEnvironment';
import { FileMenu } from '../../../desktop/src/pages/codexGui/FileMenu';
import type { DiffFile } from '../../../../shared/chat/diff';
import { EditedFilesSummary } from '../../../desktop/src/pages/codexGui/EditedFilesSummary';
import { useDetailsEntry } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatChangesPill } from './ChatChangesPill';

/** Remote paths are review buttons; they never invoke the viewing computer's file actions. */
export function ChatFilesSummary({ files, title = "client.chat.changesThisTurn", status, compact = false, beforeReview }: {
  files: readonly DiffFile[]; title?: string; status?: string; compact?: boolean; beforeReview?: ReactNode;
}) {
  const id = useId();
  const environment = useContext(FileEnvironmentContext);
  const entry = useMemo(() => ({ id, files, title, status }), [id, files, title, status]);
  const panel = useDetailsEntry(entry);
  if (!panel || !files.length) return null;
  if (compact) return <ChatChangesPill files={files} onOpen={() => panel.open(entry)} />;
  return <EditedFilesSummary files={files} title={title} status={status} beforeReview={beforeReview}
    renderFile={environment ? props => <FileMenu {...props}>{props.path}</FileMenu> : undefined}
    onReview={() => panel.open(entry)} onReviewFile={filePath => panel.open({ ...entry, filePath })} />;
}
