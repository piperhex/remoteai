import { Button, InputNumber, Select, Spin, Switch } from "antd";
import { ArrowLeftRight } from "lucide-react";
import { uiText } from "../../../../../shared/localization/uiText";
import type { Account, Provider } from "../../types";
import { MAX_REMAINING_PERCENT } from "../../../../../shared/conversation/autoSwitchSettings";
import type { GuiAutoSwitchSettings } from "../../../../../shared/conversation/autoSwitchSettings";
import type { useGuiAutoSwitchSettings } from "./useGuiAutoSwitchSettings";
import { GuiAccountSettings } from "./GuiAccountSettings";
import styles from "./GuiAutoSwitchPanel.module.less";

type Editor = ReturnType<typeof useGuiAutoSwitchSettings>;
type ProviderChoice = Pick<Provider, "id" | "name">;
type FieldsProps = { settings: GuiAutoSwitchSettings; editor: Editor; providers: ProviderChoice[] };

function fallbackProviderChoices(providers: ProviderChoice[], selected: string | null) {
  const options = providers.map((provider) => ({ value: provider.id, label: provider.name }));
  if (!selected || providers.some((provider) => provider.id === selected)) return options;
  return [...options, { value: selected, label: uiText("client.workspaceSettings.thePreviousFallbackProviderIsNoLongerAvailable"), disabled: true }];
}

function SwitchRules({ settings, editor, providers }: FieldsProps) {
  const disabled = editor.saving || !settings.enabled;
  return <div className={styles.rules}>
    <div className={styles.row}>
      <div><label htmlFor="gui-quota-exhaustion">{uiText("client.workspaceSettings.switchWhenQuotaRunsOut")}</label>
        <p>{uiText("client.guiSettings.switchToAnAvailableAccountWhenTheCurrentQuotaRuns")}</p></div>
      <Switch id="gui-quota-exhaustion" aria-label={uiText("client.workspaceSettings.switchWhenQuotaRunsOut")}
        checked={settings.switchOnQuotaExhaustion} disabled={disabled}
        onChange={(switchOnQuotaExhaustion) => editor.update({ switchOnQuotaExhaustion })} />
    </div>
    <div className={styles.row}>
      <div><label htmlFor="gui-auto-switch-threshold">{uiText("client.workspaceSettings.defaultRemainingQuotaThreshold")}</label>
        <p>{uiText("client.guiSettings.switchBelowThisRemainingQuotaAHigherAccountThresholdTakes")}</p></div>
      <InputNumber id="gui-auto-switch-threshold" aria-label={uiText("client.workspaceSettings.defaultRemainingQuotaThreshold")} suffix="%"
        min={0} max={MAX_REMAINING_PERCENT} precision={1} value={settings.minimumRemainingPercent}
        disabled={disabled} onChange={(value) => editor.update({ minimumRemainingPercent: value ?? 0 })} />
    </div>
    <div className={styles.row}>
      <div><label htmlFor="gui-auto-switch-mode">{uiText("client.workspaceSettings.assignmentMethod")}</label>
        <p>{settings.mode === "concurrent" ? uiText("client.workspaceSettings.preferDifferentAccountsForDifferentConversationsExistingConversationsKeepTheir")
          : uiText("client.workspaceSettings.useTheCurrentAccountFirstThenChooseByPriorityWhen")}</p></div>
      <Select id="gui-auto-switch-mode" aria-label={uiText("client.workspaceSettings.assignmentMethod")} value={settings.mode} disabled={disabled}
        options={[{ value: "sequential", label: uiText("client.workspaceSettings.sequentialSwitching") },
          { value: "concurrent", label: uiText("client.workspaceSettings.concurrentAssignment") }]}
        onChange={(mode: GuiAutoSwitchSettings["mode"]) => editor.update({ mode })} />
    </div>
    <div className={styles.row}>
      <div><label htmlFor="gui-auto-switch-provider">{uiText("client.workspaceSettings.fallbackProvider")}</label>
        <p>{uiText("client.workspaceSettings.useTheFallbackProviderWhenNoAccountIsAvailableA")}</p></div>
      <Select id="gui-auto-switch-provider" aria-label={uiText("client.workspaceSettings.fallbackProvider")} allowClear
        placeholder={uiText("client.workspaceSettings.noFallbackProvider")} value={settings.fallbackProviderId ?? undefined}
        disabled={disabled} options={fallbackProviderChoices(providers, settings.fallbackProviderId)}
        onChange={(id: string | undefined) => editor.update({ fallbackProviderId: id ?? null })} />
    </div>
  </div>;
}

export function GuiAutoSwitchPanel({ editor, accounts, providers, privacyMode }: {
  editor: Editor; accounts: Account[]; providers: ProviderChoice[]; privacyMode: boolean;
}) {
  const { settings } = editor;
  return <div className={styles.panel}>
    {editor.loading && <div className={styles.loading} role="status"><Spin size="small" />{uiText("client.composer.loadingSettings")}</div>}
    {editor.error && <div className={styles.error} role="alert"><span>{editor.error}</span>
      {!settings && <Button size="small" disabled={editor.loading}
        onClick={() => void editor.load()}>{uiText("client.terminal.retry")}</Button>}</div>}
    {settings && <>
      <div className={styles.enableCard} data-enabled={settings.enabled}>
        <span className={styles.enableIcon}><ArrowLeftRight size={21} strokeWidth={1.7} aria-hidden="true" /></span>
        <div><label htmlFor="gui-auto-switch-enabled">{uiText("client.workspaceSettings.switchAccountsAutomatically")}</label>
          <p>{uiText("client.guiSettings.switchAccountsWhenNeededForFewerInterruptions")}</p></div>
        <Switch id="gui-auto-switch-enabled" aria-label={uiText("client.workspaceSettings.switchAccountsAutomatically")}
          checked={settings.enabled} disabled={editor.saving} onChange={(enabled) => editor.update({ enabled })} />
      </div>
      <SwitchRules settings={settings} editor={editor} providers={providers} />
      <GuiAccountSettings settings={settings} editor={editor} accounts={accounts} privacyMode={privacyMode} />
    </>}
  </div>;
}
