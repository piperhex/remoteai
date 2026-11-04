import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { Account, AggregateApi, Provider } from "../../types";
import { maskAccountEmail } from "../../../../../shared/accounts/privacy";
import { GuiAccountList } from "../../../../../shared/conversation/GuiAccountList";
import { providerWebsiteOrigin } from '../../../../../shared/provider-market/providerWebsite';
import { GuiAccountMenu } from "../../../../../shared/conversation/GuiAccountMenu";
import type { GuiComputerNavigation } from "../../../../../shared/conversation/remote/types";
import { ProxyAccountSummary } from "./ProxyAccountSummary";
import { GuiAutoSwitchSettingsDialog } from "./GuiAutoSwitchSettingsDialog";
import styles from "../../../../../shared/conversation/ProxyAccountPicker.module.less";

export interface ProxyAccountPickerProps {
  active: boolean;
  computers?: GuiComputerNavigation;
  privacyMode: boolean;
  accounts: Account[];
  providers: Provider[];
  aggregateApis: AggregateApi[];
  busy: boolean;
  loading: boolean;
  selectionError?: string;
  onSwitchAccount: (id: string) => Promise<boolean>;
  onSwitchProvider: (id: string) => Promise<boolean>;
  onSwitchAggregate?: (id: string) => Promise<boolean>;
}

export function ProxyAccountPicker(props: ProxyAccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const provider = props.providers.find((entry) => entry.active);
  const aggregate = props.aggregateApis.find((entry) => entry.active);
  const account = props.accounts.find((entry) => entry.active);
  const thirdParty = Boolean(provider || aggregate);
  const email = account?.email && (props.privacyMode ? maskAccountEmail(account.email) : account.email);
  const name = aggregate?.name || provider?.name || email || uiText("client.conversation.chooseGuiAccount");
  const disabled = props.busy || props.loading || saving;
  // `official` describes account-pool provenance, not whether the account can use the official API.
  const accounts = props.accounts.map((entry) => ({
    kind: "account" as const, id: entry.id, name: entry.email,
    detail: entry.plan, accountDetails: { plan: entry.plan,
      primaryRemainingPercent: entry.usage?.primary?.remainingPercent,
      secondaryRemainingPercent: entry.usage?.secondary?.remainingPercent },
    selected: !thirdParty && entry.active, disabled: !entry.localProxyCompatible,
  }));
  const providers = props.providers.map((entry) => ({
    kind: "provider" as const, id: entry.id, name: entry.name, detail: entry.group || entry.model,
    websiteUrl: providerWebsiteOrigin(entry),
    selected: !aggregate && entry.active,
  }));
  const aggregates = props.aggregateApis.map((entry) => ({
    kind: "aggregate" as const, id: entry.id, name: entry.name, detail: entry.model,
    selected: entry.active, disabled: !entry.enabled || !props.onSwitchAggregate,
  }));
  useEffect(() => {
    if (!props.active) { setOpen(false); setSettingsOpen(false); }
  }, [props.active]);

  const select = async (id: string, switchAccount: (id: string) => Promise<boolean>) => {
    if (disabled || switching.current) return;
    switching.current = true;
    setSaving(true);
    setError("");
    try {
      if (await switchAccount(id)) { setOpen(false); trigger.current?.focus(); }
      else setError(uiText("client.errors.theSwitchDidNotCompletePleaseTryAgain"));
    } catch { setError(uiText("client.errors.theSwitchDidNotCompletePleaseTryAgain")); }
    finally { switching.current = false; setSaving(false); }
  };
  const panel = (devicePicker: ReactNode) => <GuiAccountList choices={[...accounts, ...providers, ...aggregates]}
    devicePicker={devicePicker} disabled={disabled} loading={saving || props.loading}
    onSelectAccount={(id) => void select(id, props.onSwitchAccount)}
    onSelectAggregate={(id) => { if (props.onSwitchAggregate) void select(id, props.onSwitchAggregate); }}
    onSelectProvider={(id) => void select(id, props.onSwitchProvider)} footer={<>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {props.selectionError && <p className={styles.error} role="alert">{props.selectionError}</p>}
      <button type="button" className={styles.settings} aria-label={uiText("client.workspaceSettings.codexGuiSettings")} aria-haspopup="dialog"
        disabled={saving || props.loading} onClick={() => { setOpen(false); setSettingsOpen(true); }}>
        <Settings size={19} />{uiText("client.app.settings")}</button>
    </>} />;
  return <><GuiAccountMenu active={props.active} open={open} name={name} trigger={trigger}
    computers={props.computers} busy={saving} accounts={panel}
    summary={<ProxyAccountSummary name={name} account={account} provider={aggregate ? undefined : provider}
      thirdParty={thirdParty} active={props.active} />}
    onOpenChange={(next) => { setOpen(next); if (next) setError(""); }} />
    {settingsOpen && props.active && <GuiAutoSwitchSettingsDialog accounts={props.accounts} providers={props.providers}
      privacyMode={props.privacyMode} onClose={() => { setSettingsOpen(false); trigger.current?.focus(); }} />}
  </>;
}
