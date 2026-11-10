import { InputNumber, Switch } from "antd";
import { UsersRound } from "lucide-react";
import { uiText } from "../../../../../shared/localization/uiText";
import type { GuiSettingsAccount } from '../../../../../shared/remote-chat/guiSettings';
import { accountExpirationDate } from "../../utils/expiration";
import { maskAccountEmail } from "../../../../../shared/accounts/privacy";
import { guiAccountRule, MAX_AUTO_SWITCH_PRIORITY, MAX_REMAINING_PERCENT,
  MIN_AUTO_SWITCH_PRIORITY } from "../../../../../shared/conversation/autoSwitchSettings";
import type { GuiAutoSwitchAccountRule, GuiAutoSwitchSettings } from "../../../../../shared/conversation/autoSwitchSettings";
import type { useGuiAutoSwitchSettings } from "./useGuiAutoSwitchSettings";
import { GuiAccountUsage } from "./GuiAccountUsage";
import styles from "./GuiAccountSettings.module.less";

type SettingsEditor = ReturnType<typeof useGuiAutoSwitchSettings>;

function AccountRule({ account, rule, disabled, onChange }: {
  account: Omit<GuiSettingsAccount, 'id'>; rule: GuiAutoSwitchAccountRule;
  disabled: boolean; onChange: (rule: GuiAutoSwitchAccountRule) => void;
}) {
  const unavailable = disabled || !account.localProxyCompatible;
  return <tr className={styles.account}>
    <td><span className={styles.email} title={account.email}>{account.email}</span></td>
    <td className={styles.expiration}>{accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt)
      ?? uiText("client.usage.unknown")}</td>
    <td><GuiAccountUsage usage={account.usage.primary} label={uiText("client.usage.primaryUsage")} /></td>
    <td><GuiAccountUsage usage={account.usage.secondary} label={uiText("client.usage.secondaryUsage")} /></td>
    <td>
      <Switch size="small" aria-label={uiText("client.workspaceSettings.includeInAutomaticSwitching", { value1: account.email })} checked={rule.enabled}
        disabled={unavailable} onChange={(enabled) => onChange({ ...rule, enabled })} />
    </td>
    {account.localProxyCompatible ? <>
      <td>
        <InputNumber size="small" aria-label={uiText("client.workspaceSettings.priority", { value1: account.email })} value={rule.priority}
          min={MIN_AUTO_SWITCH_PRIORITY} max={MAX_AUTO_SWITCH_PRIORITY} precision={0}
          disabled={unavailable || !rule.enabled} onChange={(value) => onChange({ ...rule, priority: value ?? 0 })} />
      </td>
      <td>
        <InputNumber size="small" aria-label={uiText("client.workspaceSettings.remainingQuotaThreshold", { value1: account.email })} value={rule.thresholdPercent}
          min={0} max={MAX_REMAINING_PERCENT} precision={1} suffix="%" disabled={unavailable || !rule.enabled}
          onChange={(value) => onChange({ ...rule, thresholdPercent: value ?? 0 })} />
      </td>
    </> : <td colSpan={2} className={styles.hint}>{uiText("client.workspaceSettings.thisAccountDoesNotSupportTheProxyYet")}</td>}
  </tr>;
}

export function GuiAccountSettings({ settings, editor, accounts, privacyMode }: {
  settings: GuiAutoSwitchSettings; editor: SettingsEditor; accounts: GuiSettingsAccount[]; privacyMode: boolean;
}) {
  return <section className={styles.accounts} aria-label={uiText("client.workspaceSettings.accountsIncludedInAutomaticSwitching")}>
    <div className={styles.heading}>
      <h3><UsersRound size={17} aria-hidden="true" />{uiText("client.workspaceSettings.accountsIncludedInAutomaticSwitching")}
        <span className={styles.count}>{accounts.length}</span></h3>
      <p className={styles.hint}>{uiText("client.workspaceSettings.newAccountsAreIncludedByDefaultLowerNumbersHaveHigher")}</p>
    </div>
    {accounts.length ? <div className={styles.accountTableScroll}>
      <table className={styles.accountTable} aria-label={uiText("client.workspaceSettings.accountsIncludedInAutomaticSwitching")}>
        <colgroup><col /><col className={styles.expirationColumn} />
          <col className={styles.usageColumn} /><col className={styles.usageColumn} />
          <col className={styles.participationColumn} />
          <col className={styles.numberColumn} /><col className={styles.numberColumn} /></colgroup>
        <thead><tr><th scope="col">{uiText("client.app.accounts")}</th>
          <th scope="col">{uiText("client.workspaceSettings.expiration")}</th><th scope="col">{uiText("client.usage.primaryUsage")}</th><th scope="col">{uiText("client.usage.secondaryUsage")}</th>
          <th scope="col">{uiText("client.workspaceSettings.includeInSwitching")}</th>
          <th scope="col">{uiText("client.workspaceSettings.priority.565d64")}</th><th scope="col">{uiText("client.workspaceSettings.remainingQuotaThreshold.f548ce")}</th></tr></thead>
        <tbody>{accounts.map((account) => <AccountRule key={account.id}
          account={{ email: privacyMode ? maskAccountEmail(account.email) : account.email,
            expiresAt: account.expiresAt, localProxyCompatible: account.localProxyCompatible, usage: account.usage }}
          rule={guiAccountRule(settings, account.id)} disabled={editor.saving || !settings.enabled}
          onChange={editor.updateAccount} />)}</tbody>
      </table>
    </div> : <div className={styles.empty}><UsersRound size={28} aria-hidden="true" /><p>{uiText("client.workspaceSettings.noAccountsAvailable")}</p></div>}
  </section>;
}
