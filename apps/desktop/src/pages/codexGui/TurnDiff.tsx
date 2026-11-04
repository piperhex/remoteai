import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { useContext, useEffect, useRef, useState } from "react";
import { Popconfirm } from "antd";
import { Undo2 } from "lucide-react";
import { DiffView } from "./DiffView";
import type { DiffFile } from "../../../../../shared/conversation/diff";
import { gitApi } from "../../../../../shared/conversation/gitApi";
import styles from "../../../../../shared/conversation/EditedFilesSummary.module.less";
import { WorkspaceOperationContext } from "./workspaceOperationContext";

export function TurnDiff({ files, title, threadId, turnId, disabled }: {
  files: readonly DiffFile[]; title: string; threadId?: string; turnId: string; disabled: boolean;
}) {
  const [undone, setUndone] = useState(false);
  const workspace = useContext(WorkspaceOperationContext);
  disabled = disabled || workspace.busy;
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(Boolean(threadId));
  const [error, setError] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setChecking(true);
    gitApi.undo({ threadId, turnId, checkOnly: true }).then((result) => {
      if (!cancelled) setUndone(result.undone);
    }).catch(() => {
      if (!cancelled) setError(uiText("client.workspaceActions.couldNotLoadUndoHistoryItWillBeCheckedAgain"));
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [threadId, turnId]);
  const undo = async () => {
    if (!threadId || disabled || flight.current || checking || undone) return;
    flight.current = true; setBusy(true); setError(""); workspace.setBusy(true);
    try { setUndone((await gitApi.undo({ threadId, turnId })).undone); }
    catch (error) { setError(String(error)); }
    finally { flight.current = false; setBusy(false); workspace.setBusy(false); }
  };
  const action = threadId && <Popconfirm title={uiText("client.workspaceActions.undoChangesFromThisTurn")}
    description={uiText("client.workspaceActions.filesWillBeRestoredToTheirStateBeforeThisTurn")}
    okText={uiText("client.workspaceActions.undoChanges")} cancelText={uiText("client.accounts.cancel")} disabled={disabled || checking || busy || undone}
    onConfirm={undo} styles={{ root: { maxWidth: 400 } }}>
    <button type="button" className={styles.undo} disabled={disabled || checking || busy || undone}
      aria-label={uiText("client.workspaceActions.undoChangesFromThisTurn.fc1ee9")}><span>{busy ? uiText("client.workspaceActions.undoing") : undone ? uiText("client.chat.reverted") : uiText("client.projectBrowser.undo")}</span><Undo2 size={16} /></button>
  </Popconfirm>;
  return <>
    <DiffView files={files} title={title} status={undone ? uiText("client.chat.reverted") : undefined} undo={action} />
    {error && <p role="alert" className={styles.error}>{remoteErrorText(error)}</p>}
  </>;
}
