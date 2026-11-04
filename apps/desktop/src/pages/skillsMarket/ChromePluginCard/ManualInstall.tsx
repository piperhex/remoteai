import { useState } from "react";
import { Check, Copy, ExternalLink, FolderOpen } from "lucide-react";
import type { ChromePluginAction } from "../../../api/chromePlugin";
import { uiText } from "../../../../../../shared/localization/uiText";
import styles from "./index.module.less";

interface Props {
  extensionDirectory: string;
  busy: boolean;
  onAction: (action: ChromePluginAction) => Promise<boolean>;
}

const EXTENSIONS_ADDRESS = "chrome://extensions/";

function ExtensionDirectory({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = async () => {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };
  return <>
    <button type="button" className={styles.path} aria-label={uiText("client.desktopChromePlugin.copyExtensionFolderPath")} onClick={() => void copy()}>
      <span className={styles.pathText}>{path}</span>
      <span className={styles.copyLabel} role="status">
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {uiText(copied ? "client.chat.copied" : "client.desktopChromePlugin.clickToCopy")}
      </span>
    </button>
    {copyFailed && <p className={styles.error} role="alert">{uiText("client.desktopChromePlugin.couldNotCopyThePathSelectAndCopyItManually")}</p>}
  </>;
}

export function ManualInstall({ extensionDirectory, busy, onAction }: Props) {
  const [addressCopied, setAddressCopied] = useState(false);
  const openChrome = async () => {
    setAddressCopied(false);
    setAddressCopied(await onAction("openExtensions"));
  };
  const [typeBefore, typeAfter] = uiText("client.desktopChromePlugin.youCanAlsoTypeInTheChromeAddressBarAnd").split("{value1}");
  return <details className={styles.manualInstall}>
    <summary>{uiText("client.desktopChromePlugin.manualInstallationOptional")}</summary>
    <p className={styles.hint}>{uiText("client.desktopChromePlugin.ifYouCanTUseTheStoreLoadTheExtension")}</p>
    <ol>
      <li>{uiText("client.desktopChromePlugin.openTheChromeExtensionsPageAndTurnOnDeveloperMode")}</li>
      <li>{uiText("client.desktopChromePlugin.clickLoadUnpackedPasteThePathBelowAndSelectThat")}</li>
    </ol>
    <ExtensionDirectory path={extensionDirectory} />
    <div className={styles.setupActions}>
      <button className="refresh-all" disabled={busy} onClick={() => void openChrome()}>
        <ExternalLink size={15} />{uiText("client.desktopChromePlugin.openChromeAndCopyTheAddress")}
      </button>
      <button className="refresh-all" disabled={busy} onClick={() => void onAction("openFolder")}>
        <FolderOpen size={15} />{uiText("client.desktopChromePlugin.openExtensionFolder")}
      </button>
    </div>
    {addressCopied && <p className={`${styles.hint} ${styles.feedback}`} role="status">
      {uiText("client.desktopChromePlugin.addressCopiedPasteItIntoTheChromeAddressBarAnd")}
    </p>}
    <p className={styles.hint}>{typeBefore}<code>{EXTENSIONS_ADDRESS}</code>{typeAfter}</p>
  </details>;
}
