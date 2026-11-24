import { uiText } from "../../../../../shared/localization/uiText";
import { TurnReviewNotice } from '../../../../../shared/conversation/TurnReviewNotice';
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { memo, useId, useMemo, type ReactNode } from "react";
import { DiffDocument, type DiffDocumentProps } from "../../../../../shared/conversation/DiffDocument";
import { EditedFilesSummary } from "../../../../../shared/conversation/EditedFilesSummary";
import { FileMenu } from "../../../../../shared/conversation/FileMenu";
import { useDetailsEntry, type TurnReview } from "../../../../../shared/conversation/detailsContext";

export { DiffDocument } from "../../../../../shared/conversation/DiffDocument";

export const DiffView = memo(function DiffView({ files, title = uiText("client.shared.fileChanges"), status, undo, review }:
  DiffDocumentProps & { undo?: ReactNode; review?: TurnReview }) {
  useGuiLanguage();
  const id = useId();
  const entry = useMemo(() => ({ id: review ? JSON.stringify([id, review.threadId, review.turnId, review.cwd]) : id,
    files, title, status, turnReview: review }), [id, files, title, status, review]);
  const panel = useDetailsEntry(entry);
  if (!files.length) return review?.deferred ? <><TurnReviewNotice review={review} />{undo}</> : null;
  if (!panel) return <>{undo}<DiffDocument files={files} title={title} status={status} /></>;
  return <EditedFilesSummary files={files} title={title} status={status} undo={undo}
    renderFile={props => <FileMenu {...props}>{props.path}</FileMenu>}
    onReview={() => panel.open(entry)} onReviewFile={(filePath) => panel.open({ ...entry, filePath })} />;
});
