import { uiText } from "../../i18n/uiText";
import { useContext, useEffect, useRef, useState } from "react";
import { message } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { isHostedWebApp } from "../../api/backend";
import { fileApi, FileThreadContext, type FileAction, type FileApplication } from "./fileApi";
import type { FileReference } from "./fileReference";
import { DetailsContext } from "./detailsContext";
import { FileEnvironmentContext } from './fileEnvironment';
import { isDownloadOnlyFile } from '../../../../../shared/remote-chat/filePreview';
import { animateDownloadToNavigation, type DownloadOrigin } from '../../../../web/src/downloads/downloadFeedback';
import { downloadBrowserResource } from './filePreview/downloadResource';

const FEEDBACK_STYLE = { maxWidth: 400, marginInline: "auto" };

export function useFileMenu(target: FileReference) {
  const threadId = useContext(FileThreadContext);
  const panel = useContext(DetailsContext);
  const environment = useContext(FileEnvironmentContext);
  const api = environment?.actions ?? fileApi;
  const desktop = Boolean(environment) || isTauri();
  const downloadOnly = Boolean(environment) && isDownloadOnlyFile(target.path, { mediaPreview: true });
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<FileApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  useEffect(() => {
    setOpen(false); setApplications([]);
  }, [target.path, threadId, api]);
  useEffect(() => {
    if (!open || !desktop || downloadOnly) return;
    let cancelled = false;
    setLoading(true); setFailed(false);
    void api.applications().then((value) => { if (!cancelled) setApplications(value); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, desktop, downloadOnly, api]);
  const perform = async (action: FileAction, origin?: DownloadOrigin) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setOpen(false);
    try {
      const result = desktop ? await api.perform({ ...target, threadId }, action)
        : { path: target.path, text: undefined, saved: false };
      if (action.type === "copyFile" && desktop) {
        void message.success({ content: uiText(environment ? "client.composer.fileCopiedToTheRemoteComputerSClipboard"
          : "client.composer.fileCopiedYouCanPasteItIntoAFolder"), style: FEEDBACK_STYLE });
      }
      if (action.type === "copyPath" || action.type === "copyContents") {
        await navigator.clipboard.writeText(action.type === "copyPath" ? result.path : result.text ?? "");
        void message.success({ content: uiText("client.chat.copied"), style: FEEDBACK_STYLE });
      }
      if (action.type === "saveAs" && result.saved) {
        void message.success({ content: uiText("client.workspaceActions.fileSaved"), style: FEEDBACK_STYLE });
      }
      if (action.type === "saveAs" && environment) animateDownloadToNavigation(origin);
    } catch (error) {
      // Native errors are intentionally limited to friendly messages at the IPC boundary.
      void message.error({ content: typeof error === "string" ? error : uiText("client.errors.theOperationFailedPleaseTryAgain"),
        style: FEEDBACK_STYLE });
    } finally { flight.current = false; setBusy(false); }
  };
  const preview = async () => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setOpen(false);
    try {
      const file = { ...target, threadId };
      if (panel?.openResource && isDownloadOnlyFile(target.path, { mediaPreview: true })) {
        panel.openResource(downloadBrowserResource(file)); return;
      }
      const remotePreview = environment && !isDownloadOnlyFile(target.path, { mediaPreview: true })
        ? panel?.openRemoteFile : undefined;
      try {
        if (panel && await panel.openFile(file, { browser: true })) return;
      } catch (error) {
        // Older peers and unavailable preview tunnels still support ordinary remote file reads.
        if (!remotePreview) throw error;
      }
      if (!remotePreview || !await remotePreview(file)) setOpen(true);
    } catch (error) {
      setOpen(true);
      void message.error({ content: typeof error === "string" ? error : uiText("client.workspaceActions.couldNotOpenThePreviewChooseAnotherAppToOpen"),
        style: FEEDBACK_STYLE });
    } finally { flight.current = false; setBusy(false); }
  };
  return { open, setOpen, applications, desktop, remote: Boolean(environment), downloadOnly,
    canPreview: (!downloadOnly || Boolean(panel?.openResource)) && (desktop || isHostedWebApp),
    loading, failed, busy, perform, preview };
}
