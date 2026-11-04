import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { memo, useId, useMemo, type ReactNode } from "react";
import { DiffDocument, type DiffDocumentProps } from "../../../../../shared/conversation/DiffDocument";
import { EditedFilesSummary } from "../../../../../shared/conversation/EditedFilesSummary";
import { FileMenu } from "../../../../../shared/conversation/FileMenu";
import { useDetailsEntry } from "../../../../../shared/conversation/detailsContext";

export { DiffDocument } from "../../../../../shared/conversation/DiffDocument";

export const DiffView = memo(function DiffView({ files, title = uiText("client.shared.fileChanges"), status, undo }:
  DiffDocumentProps & { undo?: ReactNode }) {
  useGuiLanguage();
  const id = useId();
  const entry = useMemo(() => ({ id, files, title, status }), [id, files, title, status]);
  const panel = useDetailsEntry(entry);
  if (!files.length) return null;
  if (!panel) return <>{undo}<DiffDocument files={files} title={title} status={status} /></>;
  return <EditedFilesSummary files={files} title={title} status={status} undo={undo}
    renderFile={props => <FileMenu {...props}>{props.path}</FileMenu>}
    onReview={() => panel.open(entry)} onReviewFile={(filePath) => panel.open({ ...entry, filePath })} />;
});
