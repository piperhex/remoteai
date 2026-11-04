import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { useState } from "react";
import { Alert, Button, Input, Segmented } from "antd";
import { useLanguage } from "../../hooks/useLanguage";
import { DreamSkinBrowser } from "../dreamSkin/DreamSkinBrowser";
import { DreamSkinOverlaySlider } from "../dreamSkin/DreamSkinOverlaySlider";
import { useDreamSkinCatalog } from "../dreamSkin/useDreamSkinCatalog";
import type { ThemeTab } from "../dreamSkin/types";
import { useGuiSkin, type GuiSkin } from "./guiSkin";
import { useGuiSkinLibrary } from "./useGuiSkinLibrary";
import styles from "./GuiSkinSettings.module.less";

export function GuiSkinSettings() {
  const { t } = useLanguage();
  const settings = useGuiSkin();
  const [themeTab, setThemeTab] = useState<ThemeTab>("builtIn");
  const [queries, setQueries] = useState({ builtIn: "", saved: "" });
  const catalog = useDreamSkinCatalog(themeTab);
  const library = useGuiSkinLibrary(catalog);
  const isBusy = library.busy !== null;
  const resourceUnavailable = !library.resources?.installed;
  const resourceMessage = library.resources?.phase === "error" ? uiText("client.workspaceSettings.couldNotDownloadTheThemeImagePleaseTryAgain")
    : library.resources?.phase === "unsupported" ? uiText("client.workspaceSettings.thisDeviceCannotLoadBuiltInThemesYet") : uiText("client.workspaceSettings.preparingTheThemeImagePleaseWait");
  return <section className={styles.panel} aria-label={uiText("client.workspaceSettings.codexGuiThemes")}>
    <div className={styles.toolbar}>
      <p className={styles.hint}>{uiText("client.workspaceSettings.chooseABackgroundFromTheThemeLibraryForCodexGui")}</p>
      <div className={styles.controls}>
        <Segmented<GuiSkin["mode"]> aria-label={uiText("client.workspaceSettings.themeBehavior")} value={settings.mode} disabled={isBusy}
          options={[{ value: "inherit", label: uiText("client.workspaceSettings.followThemePage") }, { value: "custom", label: uiText("client.workspaceSettings.chooseIndependently") },
            { value: "none", label: uiText("client.workspaceSettings.noTheme") }]} onChange={(mode) => library.update({ mode })} />
        <DreamSkinOverlaySlider disabled={isBusy || settings.mode !== "custom" || !settings.themeId}
          opacity={settings.overlayOpacity}
          onChange={(overlayOpacity) => library.update({ overlayOpacity })} t={t} />
      </div>
      {settings.mode === "custom" && !settings.themeId && <p className={styles.hint}>{uiText("client.workspaceSettings.chooseAThemeBelow")}</p>}
      <div className={styles.controls}>
        <Segmented<ThemeTab> aria-label={uiText("client.workspaceSettings.themeSource")} value={themeTab}
          options={[{ value: "builtIn", label: uiText("client.workspaceSettings.builtInThemes") },
            { value: "market", label: uiText("client.workspaceSettings.communityThemes") }, { value: "saved", label: uiText("client.configHelp.saved") }]}
          onChange={(next) => { setThemeTab(next); if (next === "saved") void library.refreshSaved(); }} />
        <Input.Search className={styles.search} aria-label={uiText("client.workspaceSettings.searchThemes")} placeholder={uiText("client.workspaceSettings.searchThemes")} allowClear
          value={themeTab === "market" ? catalog.marketQuery : queries[themeTab]}
          onChange={(event) => themeTab === "market"
            ? catalog.setMarketQuery(event.target.value)
            : setQueries({ ...queries, [themeTab]: event.target.value })} />
        <Button size="small" disabled={isBusy} onClick={() => {
          void library.refreshSaved();
          if (themeTab === "market") catalog.refreshThemeMarket();
        }}>{uiText("client.chat.refresh")}</Button>
      </div>
      {library.error && <Alert type="error" showIcon closable message={remoteErrorText(library.error)}
        onClose={() => library.setError(null)} />}
      {resourceUnavailable && themeTab === "builtIn" && <Alert showIcon
        type={library.resources?.phase === "error" ? "error" : "info"}
        message={resourceMessage}
        action={library.resources?.phase === "error" && <Button size="small"
          onClick={() => void library.retry()}>{uiText("client.terminal.retry")}</Button>} />}
    </div>
    <div className={styles.browser}>
      <DreamSkinBrowser actions={library.actions} busy={library.busy} isBusy={isBusy}
        builtInQuery={queries.builtIn} savedQuery={queries.saved} catalog={catalog} savedThemes={library.savedThemes}
        resourcesReady={library.resources?.installed === true} showInstallHint={false}
        status={{ installed: false, activeThemeId: settings.mode === "custom" ? settings.themeId : null }}
        t={t} themeTab={themeTab} />
    </div>
  </section>;
}
