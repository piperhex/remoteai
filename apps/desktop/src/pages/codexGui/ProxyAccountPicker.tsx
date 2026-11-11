import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { message } from 'antd';
import { accountSource, accountSourceLabel } from '../../../../../shared/accounts/source';
import { useCliGui } from '../../../../../shared/cli-gui/context';
import { guiAccountSelectionForEngine, isGuiAccountSelected } from '../../../../../shared/remote-chat/guiAccounts';
import type { GuiAccountSelection } from '../../../../../shared/remote-chat/guiAccounts';
import { claudeAccountError } from '../../../../../shared/accounts/claudeAccounts';
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
  const cli = useCliGui();
  const [notice, noticeContext] = message.useMessage();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selection = guiAccountSelectionForEngine(proxySelection(props), props.accounts, cli?.state.engine);
  const selected = (kind: 'account' | 'provider' | 'aggregate', id: string) =>
    isGuiAccountSelected({ kind, id }, selection);
  const provider = props.providers.find(entry => selected('provider', entry.id));
  const aggregate = props.aggregateApis.find(entry => selected('aggregate', entry.id));
  const account = props.accounts.find(entry => selected('account', entry.id));
  const thirdParty = Boolean(provider || aggregate);
  const email = account?.email && (props.privacyMode ? maskAccountEmail(account.email) : account.email);
  const name = aggregate?.name || provider?.name || email || uiText("client.conversation.chooseGuiAccount");
  const disabled = props.busy || props.loading || saving;
  // `official` describes account-pool provenance, not whether the account can use the official API.
  const accounts = props.accounts.map((entry) => ({
    kind: "account" as const, id: entry.id, name: entry.email,
    detail: accountSource(entry) === 'claudeCode' ? `${accountSourceLabel(entry)} · ${entry.plan}` : entry.plan,
    accountDetails: accountSource(entry) === 'claudeCode' ? undefined : { plan: entry.plan,
      primaryRemainingPercent: entry.usage?.primary?.remainingPercent,
      secondaryRemainingPercent: entry.usage?.secondary?.remainingPercent },
    selected: selected('account', entry.id),
    disabled: accountSource(entry) !== 'claudeCode' && !entry.localProxyCompatible,
  }));
  const providers = props.providers.map((entry) => ({
    kind: "provider" as const, id: entry.id, name: entry.name, detail: entry.group || entry.model,
    websiteUrl: providerWebsiteOrigin(entry),
    selected: selected('provider', entry.id),
  }));
  const aggregates = props.aggregateApis.map((entry) => ({
    kind: "aggregate" as const, id: entry.id, name: entry.name, detail: entry.model,
    selected: selected('aggregate', entry.id), disabled: !entry.enabled || !props.onSwitchAggregate,
  }));
  useEffect(() => {
    if (!props.active) { setOpen(false); setSettingsOpen(false); }
  }, [props.active]);

  const select = async (id: string, switchAccount: (id: string) => Promise<boolean>) => {
    if (disabled || switching.current) return;
    switching.current = true;
    setSaving(true);
    setError("");
    const claude = props.accounts.some(account => account.id === id && accountSource(account) === 'claudeCode');
    try {
      if (await switchAccount(id)) {
        setOpen(false); trigger.current?.focus();
        if (claude) {
          void notice.success({ content: uiText('client.officialAccounts.switched'),
            style: { maxWidth: 400, margin: '0 auto' } });
        }
      }
      else setError(uiText("client.errors.theSwitchDidNotCompletePleaseTryAgain"));
    } catch (error) {
      setError(claude ? claudeAccountError(error) : uiText("client.errors.theSwitchDidNotCompletePleaseTryAgain"));
    }
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
    {noticeContext}
    {settingsOpen && props.active && <GuiAutoSwitchSettingsDialog
      accounts={props.accounts.filter(account => accountSource(account) === 'codex')} providers={props.providers}
      privacyMode={props.privacyMode} onClose={() => { setSettingsOpen(false); trigger.current?.focus(); }} />}
  </>;
}

function proxySelection(props: ProxyAccountPickerProps): GuiAccountSelection {
  const aggregate = props.aggregateApis.find(entry => entry.active);
  if (aggregate) return { kind: 'aggregate', id: aggregate.id };
  const provider = props.providers.find(entry => entry.active);
  if (provider) return { kind: 'provider', id: provider.id };
  const account = props.accounts.find(entry => entry.active && accountSource(entry) === 'codex');
  return account ? { kind: 'account', id: account.id } : { kind: 'none' };
}
