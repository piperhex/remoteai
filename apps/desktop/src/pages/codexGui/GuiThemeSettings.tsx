import { displayText } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button, ColorPicker, Segmented, Switch, theme } from "antd";
import { Monitor, Moon, Sun } from "lucide-react";
import { DEFAULT_GUI_THEME, saveGuiTheme, useGuiTheme, type GuiTheme } from "./guiTheme";
import styles from "./GuiThemeSettings.module.less";

const THEME_MODES = [{ value: "inherit", label: "client.workspaceSettings.followApp", icon: Monitor },
  { value: "light", label: "client.workspaceSettings.light", icon: Sun }, { value: "dark", label: "client.workspaceSettings.dark", icon: Moon }] as const;

export function GuiThemeSettings() {
  const settings = useGuiTheme();
  const { token } = theme.useToken();
  const [error, setError] = useState("");
  const update = (patch: Partial<GuiTheme>) => {
    setError(saveGuiTheme(patch) ? "" : uiText("client.workspaceSettings.couldNotSaveTheThemePleaseTryAgain"));
  };
  return <section className={styles.panel} aria-label={uiText("client.workspaceSettings.themeSettings")}>
    <div className={styles.card}>
    <h3>{uiText("client.workspaceSettings.appearance")}</h3>
    <p className={styles.hint}>{uiText("client.workspaceSettings.chooseAnAppearanceForCodexGuiChangesAreSavedAutomatically")}</p>
    <Segmented<GuiTheme["mode"]> className={styles.modes} block
      aria-label={uiText("client.workspaceSettings.codexGuiAppearance")} value={settings.mode}
      options={THEME_MODES.map(({ value, label, icon: Icon }) => ({ value,
        label: <div className={styles.mode} data-mode={value}>
          <div className={styles.miniWindow} aria-hidden="true"><i /><div><b /><b /><b /></div></div>
          <span><Icon size={15} aria-hidden="true" />{displayText(label)}</span>
        </div> }))} onChange={(mode) => update({ mode })} />
    </div>
    <div className={styles.card}>
    <h3>{uiText("client.workspaceSettings.accentColor")}</h3>
    <div className={styles.controls}>
      <label htmlFor="gui-theme-color-inherit">{uiText("client.workspaceSettings.useAppAccentColor")}</label>
      <Switch id="gui-theme-color-inherit" size="small" checked={settings.color === null}
        onChange={(inherit) => update({ color: inherit ? null : token.colorPrimary })} />
      <ColorPicker value={settings.color ?? token.colorPrimary} disabled={settings.color === null}
        showText disabledAlpha format="hex" onChangeComplete={(color) => update({ color: color.toHexString() })} />
    </div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.preview} aria-label={uiText("client.workspaceSettings.themePreview")}>
      <div className={styles.sidebar}><strong>Codex GUI</strong><span>{uiText("client.workspaceSettings.newConversation.b93fe9")}</span></div>
      <div className={styles.conversation}>
        <span className={styles.caption}><span className={styles.previewDot} />{uiText("client.chat.preview")}</span>
        <p>{uiText("client.workspaceSettings.helloWhatWouldYouLikeToWorkOnToday")}</p>
        <div className={styles.reply}>{uiText("client.workspaceSettings.letSBringYourIdeasToLife")}</div>
        <div className={styles.composer}><span>{uiText("client.workspaceSettings.shareYourIdea")}</span><span className={styles.send}>↑</span></div>
      </div>
    </div>
    <Button onClick={() => update(DEFAULT_GUI_THEME)}
      disabled={settings.mode === "inherit" && settings.color === null}>{uiText("client.chat.restoreDefaults")}</Button>
  </section>;
}
