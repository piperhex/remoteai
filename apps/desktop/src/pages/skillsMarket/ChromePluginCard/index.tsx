import { pluginSearch } from '@remoteai/i18n/copy/desktop/pluginSearch';
import { displayError } from '../../../../../../shared/localization/uiText';
import { useEffect, useState } from "react";
import { Globe, LoaderCircle, Power, Settings2 } from "lucide-react";
import { useChromePlugin } from "./useChromePlugin";
import { ChromeSetup } from "./ChromeSetup";
import type { ChromePluginStatus } from "../../../api/chromePlugin";
import { translate } from "../../../i18n";
import { uiText } from "../../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../../shared/localization/useGuiLanguage";
import styles from "./index.module.less";

interface Props {
  homeId: string;
  active: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function chromePluginMatches(query: string) {
  return pluginSearch.chrome.includes(query.trim().toLocaleLowerCase());
}

function connectionText(status: ChromePluginStatus | null, busy: boolean) {
  if (!status) return uiText("client.desktopChromePlugin.checking");
  if (!status.supported) return uiText("client.desktopChromePlugin.notSupportedOnThisSystem");
  if (!status.installed) return uiText(busy ? "client.desktopChromePlugin.preparingTheBrowserAssistant" : "client.desktopChromePlugin.notReadyClickEnable");
  if (status.needsRepair) return uiText("client.desktopChromePlugin.pluginSettingsNeedRepair");
  if (!status.enabled) return uiText("client.desktopChromePlugin.disabled");
  if (!status.connectedBrowsers) return uiText("client.desktopChromePlugin.waitingForChromeToConnect");
  if (!status.activeBrowsers) return uiText("client.desktopChromePlugin.browserControlPaused");
  return uiText("client.desktopChromePlugin.connectedBrowsers", { count: status.connectedBrowsers });
}

export function ChromePluginCard({ homeId, active, onBusyChange }: Props) {
  const language = useGuiLanguage();
  const { status, error, busy, refresh, run } = useChromePlugin(homeId, active);
  const [setup, setSetup] = useState(false);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  return <article className={`skill-card ${styles.card}`}>
    <div className={`skill-card-preview ${styles.preview}`}>
      <div className={styles.icon}><Globe size={45} /></div>
      <span className="skill-official-badge">{uiText("client.desktopChromePlugin.builtInPlugin")}</span>
      {status?.version && <span className="skill-version">v{status.version}</span>}
    </div>
    <div className="skill-card-body">
      <div className="skill-card-title"><h3>{uiText("client.desktopChromePlugin.chromeBrowserAssistant")}</h3></div>
      <p>{uiText("client.desktopChromePlugin.readsPagesClicksTypesAndTakesScreenshotsOnSitesYou")}</p>
      <div className={styles.connection} role="status">{connectionText(status, busy)}</div>
      {error && <div className={styles.error} role="alert">{displayError(error)}</div>}
      <div className="skill-card-meta"><span>Remote AI</span><span>{uiText("client.configLabels.browser")}</span></div>
      <div className={styles.cardActions}>
        <button className="refresh-all" disabled={busy || !status?.supported || !status.installed}
          onClick={() => setSetup(true)}>
          <Settings2 size={15} />{uiText("client.desktopChromePlugin.installAndConnect")}
        </button>
        <button className={`official-plugin-toggle${status?.enabled ? " active" : ""}`}
          disabled={busy || !status?.supported}
          onClick={() => void run(status?.enabled ? "disable" : "enable")}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Power size={16} />}
          {/* The shared "启用" entry is the "Enabled" state label; this is the Enable action. */}
          {status?.enabled ? uiText("client.desktopChromePlugin.disable") : translate(language, "skills.official.enable")}
        </button>
      </div>
    </div>
    {setup && status && <ChromeSetup status={status} busy={busy} error={error} onClose={() => setSetup(false)}
      onAction={run} onRefresh={refresh} />}
  </article>;
}
