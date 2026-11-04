import { displayError } from '../../../../../shared/localization/uiText';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Popconfirm } from "antd";
import {
  COZE_DESKTOP_READY, COZE_DESKTOP_STATE, COZE_DESKTOP_STOP, COZE_DESKTOP_STOP_READY, type CozeDesktopState,
  withCozeLanguage,
} from "../../../../../shared/coze/desktopBridge";
import { guiLanguage, uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../shared/localization/useGuiLanguage";
import styles from "./CozePage.module.less";

interface CozeWorkspaceProps {
  url: string;
  busy: boolean;
  error: string;
  onStop: () => Promise<void>;
}

export function CozeWorkspace({ url, busy, error, onStop }: CozeWorkspaceProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [readyUrl, setReadyUrl] = useState<string>();
  const language = useGuiLanguage();
  // The fragment only sets the first language; switches go through the state message so the
  // editor never reloads and unsaved drafts survive.
  const src = useMemo(() => withCozeLanguage(url, guiLanguage()), [url]);
  const origin = new URL(url).origin;
  const sendState = useCallback(() => {
    const state: CozeDesktopState = { type: COZE_DESKTOP_STATE, busy, language };
    frame.current?.contentWindow?.postMessage(state, origin);
  }, [busy, language, origin]);
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (event.data === COZE_DESKTOP_READY) sendState();
      if (event.data === COZE_DESKTOP_STOP_READY) setReadyUrl(url);
      if (event.data === COZE_DESKTOP_STOP && !busy) void onStop();
    };
    window.addEventListener("message", receive);
    sendState();
    return () => window.removeEventListener("message", receive);
  }, [busy, onStop, origin, sendState, url]);
  return <div className={styles.workspace}>
    {error && <Alert type="error" message={displayError(error)} />}
    {(readyUrl !== url || !!error) && <div className={styles.workspaceControls}>
      <Popconfirm title={uiText("client.coze.stopCozeYourSavedContentWillBeKept")}
        okText={uiText("client.shared.stop")} cancelText={uiText("client.accounts.cancel")} disabled={busy}
        styles={{ root: { maxWidth: 400 } }} onConfirm={onStop}>
        <Button danger loading={busy}>{uiText("client.coze.stopCoze")}</Button>
      </Popconfirm>
    </div>}
    <iframe key={url} ref={frame} title="Coze" src={src}
      onLoad={() => { setReadyUrl(undefined); sendState(); }} onError={() => setReadyUrl(undefined)}
      sandbox="allow-scripts allow-same-origin allow-downloads" />
  </div>;
}
