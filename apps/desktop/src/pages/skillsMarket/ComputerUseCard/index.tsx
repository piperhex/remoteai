import { pluginSearch } from '@remoteai/i18n/copy/desktop/pluginSearch';
import { displayError } from '../../../../../../shared/localization/uiText';
import { useEffect } from "react";
import { Popconfirm } from "antd";
import { Download, LoaderCircle, Monitor, Power, RefreshCw, Trash2 } from "lucide-react";
import type { ComputerUseStatus } from "../../../api/computerUse";
import { translate } from "../../../i18n";
import { uiText } from "../../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../../shared/localization/useGuiLanguage";
import { useComputerUse } from "./useComputerUse";
import { Permissions } from "./Permissions";
import styles from "./index.module.less";

interface Props { homeId: string; active: boolean; onBusyChange: (busy: boolean) => void }

export function computerUseMatches(query: string) {
  return pluginSearch.computer.includes(query.trim().toLocaleLowerCase());
}

function statusText(status: ComputerUseStatus | null) {
  if (!status) return uiText("client.desktopChromePlugin.checking");
  if (!status.supported) return uiText("client.desktopBuiltinPlugins.requires64BitWindowsOrMacos13OrLater");
  if (!status.installed) return uiText("client.desktopBuiltinPlugins.availableInCodexGuiOnceInstalled");
  if (status.needsRepair) return uiText("client.desktopBuiltinPlugins.installationNeedsRepair");
  if (status.enabled && status.permissions
    && (!status.permissions.accessibility || !status.permissions.screenRecording)) {
    return uiText("client.desktopBuiltinPlugins.installedAllowDesktopControlPermissions");
  }
  return uiText(status.enabled ? "client.desktopBuiltinPlugins.enabledReadyToUseInChats" : "client.desktopChromePlugin.disabled");
}

export function ComputerUseCard({ homeId, active, onBusyChange }: Props) {
  const language = useGuiLanguage();
  const { status, error, busy, refresh, run, requestPermission } = useComputerUse(homeId, active);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  // The shared "启用" entry is the "Enabled" state label; the key-based copy holds the Enable/Uninstall actions.
  const uninstall = translate(language, "skills.official.uninstall");
  return <article className={`skill-card ${styles.card}`}>
    <div className={`skill-card-preview ${styles.preview}`}>
      <div className={styles.icon}><Monitor size={45} /></div>
      <span className="skill-official-badge">{uiText("client.desktopChromePlugin.builtInPlugin")}</span>
      {status?.version && <span className="skill-version">CUA v{status.version}</span>}
    </div>
    <div className="skill-card-body">
      <div className="skill-card-title"><h3>{uiText("client.desktopBuiltinPlugins.computerUseAssistant")}</h3></div>
      <p>{uiText("client.desktopBuiltinPlugins.letsCodexSeeTheScreenClickTypeAndWorkWith")}</p>
      <div className={styles.status} role="status">{statusText(status)}</div>
      {status?.permissions && <Permissions permissions={status.permissions} busy={busy} onRequest={requestPermission} />}
      {error && <div className={styles.error} role="alert">{displayError(error)}</div>}
      <div className="skill-card-meta"><span>Remote AI · CUA</span><span>{uiText("client.configLabels.computerUse")}</span></div>
      {status?.installed ? <div className="official-plugin-actions">
        <button className={`official-plugin-toggle${status.enabled ? " active" : ""}`} disabled={busy}
          onClick={() => void run(status.enabled ? "disable" : "enable")}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Power size={16} />}
          {status.needsRepair ? uiText("client.desktopBuiltinPlugins.repair")
            : status.enabled ? uiText("client.desktopChromePlugin.disable") : translate(language, "skills.official.enable")}
        </button>
        <Popconfirm title={uiText("client.desktopBuiltinPlugins.uninstallComputerUseFromThisFolder")} description={uiText("client.desktopBuiltinPlugins.installationsInOtherFoldersWonTBeAffected")}
          overlayClassName={styles.confirm} okText={uninstall} cancelText={uiText("client.accounts.cancel")}
          onConfirm={() => void run("remove")}>
          <button className="skill-install-button uninstall" disabled={busy}><Trash2 size={16} />{uninstall}</button>
        </Popconfirm>
      </div> : <button className="skill-install-button" disabled={busy || !status?.supported}
        onClick={() => void run("install")}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {uiText(busy ? "client.desktopBuiltinPlugins.installingPleaseWait" : "client.desktopBuiltinPlugins.install")}
      </button>}
      {error && <button className={styles.retry} disabled={busy} onClick={() => void refresh()}>
        <RefreshCw size={14} />{uiText("client.desktopBuiltinPlugins.checkAgain")}
      </button>}
    </div>
  </article>;
}
