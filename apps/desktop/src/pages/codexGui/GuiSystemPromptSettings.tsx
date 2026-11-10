import { uiText } from "../../../../../shared/localization/uiText";
import { Button, Spin } from "antd";
import { useLanguage } from "../../hooks/useLanguage";
import { SystemPromptPage } from "../SystemPromptPage";
import { useGuiSystemPrompts } from "./useGuiSystemPrompts";
import type { GuiSettingsClient } from '../../../../../shared/remote-chat/guiSettings';
import styles from "./GuiAutoSwitchSettingsDialog.module.less";

export function GuiSystemPromptSettings({ api }: { api?: GuiSettingsClient['systemPrompts'] }) {
  const editor = useGuiSystemPrompts(api);
  const { t } = useLanguage();
  return <section className={styles.promptPanel} aria-label={uiText("client.workspaceSettings.codexGuiSystemPrompt")}>
    {editor.loading && <div className={styles.loading} role="status"><Spin size="small" />{uiText("client.composer.loadingSettings")}</div>}
    {editor.error && <div className={styles.error} role="alert">
      <span>{editor.error}</span>
      {!editor.settings && <Button size="small" disabled={editor.loading}
        onClick={() => void editor.load()}>{uiText("client.terminal.retry")}</Button>}
    </div>}
    {editor.settings && <SystemPromptPage embedded {...editor.settings} loading={editor.saving} t={t}
      notice={uiText("client.workspaceSettings.appliesOnlyToCodexGuiConversationsChangesAreSavedAutomatically")}
      onFilterEnabledChange={(filterEnabled) => void editor.update({ filterEnabled })}
      onFilterRulesChange={(filterRules) => editor.update({ filterRules })}
      onInjectionEnabledChange={(injectionEnabled) => void editor.update({ injectionEnabled })}
      onInjectionPromptsChange={(injectionPrompts) => editor.update({ injectionPrompts })} />}
  </section>;
}
