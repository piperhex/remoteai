import { pluginSearch } from '@remoteai/i18n/copy/desktop/pluginSearch';
import { displayError } from '../../../../../../shared/localization/uiText';
import { useEffect } from "react";
import { Popconfirm } from "antd";
import { Download, LoaderCircle, Power, RefreshCw, Terminal, Trash2 } from "lucide-react";
import type { RemoteCommandStatus } from "../../../api/remoteCommand";
import { translate } from "../../../i18n";
import { uiText } from "../../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../../shared/localization/useGuiLanguage";
import { useRemoteCommand } from "./useRemoteCommand";
import styles from "./index.module.less";

interface Props { homeId: string; active: boolean; onBusyChange: (busy: boolean) => void }

export function remoteCommandMatches(query: string) {
  return pluginSearch.remoteCommand.includes(query.trim().toLocaleLowerCase());
}

function statusText(status: RemoteCommandStatus | null) {
  if (!status) return uiText("client.desktopChromePlugin.checking");
  if (!status.installed) return uiText("client.desktopBuiltinPlugins.installOnBothComputersToUseItInChats");
  if (status.needsRepair) return uiText("client.desktopBuiltinPlugins.installationNeedsRepair");
  return uiText(status.enabled ? "client.desktopBuiltinPlugins.enabledCanSendAndReceiveRemoteCommands" : "client.desktopBuiltinPlugins.disabledCanTSendOrReceiveRemoteCommands");
}

export function RemoteCommandCard({ homeId, active, onBusyChange }: Props) {
  const language = useGuiLanguage();
  const { status, error, busy, refresh, run } = useRemoteCommand(homeId, active);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  // The shared "启用" entry is the "Enabled" state label; the key-based copy holds the Enable/Uninstall actions.
  const uninstall = translate(language, "skills.official.uninstall");
  return <article className={`skill-card ${styles.card}`}>
    <div className={`skill-card-preview ${styles.preview}`}>
      <div className={styles.icon}><Terminal size={45} /></div>
      <span className="skill-official-badge">{uiText("client.desktopChromePlugin.builtInPlugin")}</span>
      {status?.version && <span className="skill-version">v{status.version}</span>}
    </div>
    <div className="skill-card-body">
      <div className="skill-card-title"><h3>{uiText("client.desktopBuiltinPlugins.remoteCommands")}</h3></div>
      <p>{uiText("client.desktopBuiltinPlugins.letsAiRunCommandsAndTroubleshootAcrossComputersSignedIn")}</p>
      <div className={styles.status} role="status">{statusText(status)}</div>
      {error && <div className={styles.error} role="alert">{displayError(error)}</div>}
      <div className="skill-card-meta"><span>Remote AI</span><span>{uiText("client.desktopBuiltinPlugins.remoteDiagnostics")}</span></div>
      {status?.installed ? <div className="official-plugin-actions">
        <button className={`official-plugin-toggle${status.enabled ? " active" : ""}`} disabled={busy}
          onClick={() => void run(status.enabled ? "disable" : "enable")}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Power size={16} />}
          {status.needsRepair ? uiText("client.desktopBuiltinPlugins.repair")
            : status.enabled ? uiText("client.desktopChromePlugin.disable") : translate(language, "skills.official.enable")}
        </button>
        <Popconfirm title={uiText("client.desktopBuiltinPlugins.uninstallTheRemoteCommandsPlugin")} description={uiText("client.desktopBuiltinPlugins.afterUninstallingThisInstallationCanTSendOrReceiveRemote")}
          overlayClassName={styles.confirm} okText={uninstall} cancelText={uiText("client.accounts.cancel")}
          onConfirm={() => void run("remove")}>
          <button className="skill-install-button uninstall" disabled={busy}><Trash2 size={16} />{uninstall}</button>
        </Popconfirm>
      </div> : <button className="skill-install-button" disabled={busy || !status}
        onClick={() => void run("install")}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {uiText(busy ? "client.desktopBuiltinPlugins.installing" : "client.desktopBuiltinPlugins.install")}
      </button>}
      {error && <button className={styles.retry} disabled={busy} onClick={() => void refresh()}>
        <RefreshCw size={14} />{uiText("client.desktopBuiltinPlugins.checkAgain")}
      </button>}
    </div>
  </article>;
}
