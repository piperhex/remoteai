import { displayError } from '../../../../../../shared/localization/uiText';
import { Modal } from "antd";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ChromePluginAction, ChromePluginStatus } from "../../../api/chromePlugin";
import { uiText } from "../../../../../../shared/localization/uiText";
import { ManualInstall } from "./ManualInstall";
import styles from "./index.module.less";

interface Props {
  status: ChromePluginStatus;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAction: (action: ChromePluginAction) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}

export function ChromeSetup({ status, busy, error, onClose, onAction, onRefresh }: Props) {
  return <Modal open title={uiText("client.desktopChromePlugin.installAndConnectTheChromeBrowserAssistant")} width={448} footer={null} onCancel={onClose}>
    <div className={styles.setup}>
      <p>{uiText("client.desktopChromePlugin.addTheBrowserAssistantFromTheChromeWebStoreOnce")}</p>
      <ol>
        <li>{uiText("client.desktopChromePlugin.openTheStorePageBelowClickAddToChromeAnd")}</li>
        <li>{uiText("client.desktopChromePlugin.openTheRemoteAiBrowserAssistantFromTheChromeToolbar")}</li>
        <li>{uiText("client.desktopChromePlugin.returnToRemoteAiAndStartANewTaskTo")}</li>
      </ol>
      <div className={styles.setupActions}>
        <button className="primary-button" disabled={busy} onClick={() => void onAction("openStore")}>
          <ExternalLink size={15} />{uiText("client.desktopChromePlugin.goToTheChromeWebStore")}
        </button>
        <button className="refresh-all" disabled={busy} onClick={() => void onRefresh()}>
          <RefreshCw size={15} />{uiText("client.desktopChromePlugin.checkConnection")}
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{displayError(error)}</p>}
      <p className={styles.connection} role="status">
        {status.connectedBrowsers > 0
          ? uiText("client.desktopChromePlugin.connectedBrowsers", { count: status.connectedBrowsers })
          : uiText("client.desktopChromePlugin.waitingForChromeToConnect.439a6b")}
      </p>
      <p className={styles.hint}>
        {uiText("client.desktopChromePlugin.allSitesAreAllowedByDefaultYouCanSwitchTo")}
      </p>
      <ManualInstall extensionDirectory={status.extensionDirectory} busy={busy} onAction={onAction} />
    </div>
  </Modal>;
}
