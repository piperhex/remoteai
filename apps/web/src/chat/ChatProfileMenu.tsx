import { displayError } from '../i18n/index';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { Download, Monitor, User } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { guiAccountAvatar } from '../../../../shared/remote-chat/guiAccountAvatar';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import { ChatSettingsConnection } from './ChatSettingsConnection';

const ACCOUNT_REFRESH_MS = 60_000;
export interface ChatConnectionProps {
  client: GuiAccountsClient; deviceName: string; chooseDevice: () => void;
}
type Props = ChatConnectionProps & { ready: boolean; active?: boolean } & (
  { variant: 'settings'; compact?: boolean } | { variant?: 'profile'; email: string;
    guiTools: GuiToolsClient; running: boolean }
);

export function ChatProfileMenu(props: Props) {
  const { client, deviceName, ready, chooseDevice, active = true } = props;
  const settings = props.variant === 'settings';
  useLanguage();
  const [panel, setPanel] = useState<'profile' | 'accounts' | 'update' | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { if (!active) setPanel(null); }, [active]);
  const accounts = useGuiAccounts(client, ready, panel === 'accounts' ? ACCOUNT_REFRESH_MS : 0);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find(choice => selection?.kind === choice.kind && selection.id === choice.id);
  const { initials } = guiAccountAvatar(accounts.snapshot, t("client.chat.me"));
  const disabled = accounts.loading || Boolean(accounts.saving) || !ready || !accounts.snapshot?.running;
  const choices = accounts.snapshot?.choices.filter(choice =>
    `${choice.name} ${choice.detail} ${choice.searchDetail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const select = async (choice: GuiAccountChoice) => {
    if (!disabled && choice.available && choice !== current
      && await accounts.select({ kind: choice.kind, id: choice.id })) setPanel(settings ? null : 'profile');
  };
  const close = () => { if (!accounts.saving) setPanel(null); };
  const connectionOptions = <>
    <button type="button" className="chat-profile-option" aria-label={t("client.chat.switchComputer")}
      onClick={() => { close(); chooseDevice(); }}><Monitor size={22} /><span className="chat-grow">
        <strong>{t("client.chat.switchComputer")}</strong><small>{deviceName}</small></span><span>›</span></button>
    <button type="button" className="chat-profile-option" aria-label={t("client.chat.switchAccount")}
      onClick={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }}>
      <User size={22} /><span className="chat-grow"><strong>{t("client.chat.switchAccount")}</strong>
        <small>{current?.name || t("client.chat.chooseAccount")}</small></span><span>›</span></button>
  </>;
  return <>
    {settings ? (props.compact ? <ChatSettingsConnection deviceName={deviceName}
      accountName={current?.name || t('client.chat.chooseAccount')}
      onDevice={() => { close(); chooseDevice(); }}
      onAccount={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }} />
      : connectionOptions) : <button type="button"
      className="chat-profile-trigger"
      aria-label={t("client.chat.openProfileMenu")} aria-expanded={panel !== null} onClick={() => setPanel('profile')}>
      {initials}</button>}
    {panel === 'update' && active && props.variant !== 'settings' && <ChatGuiUpdateSheet client={props.guiTools}
      active={active} connected={ready} running={props.running} deviceName={deviceName}
      onClose={close} onBack={() => setPanel('profile')} />}
    {panel && panel !== 'update' && <AdaptiveSheet open
      title={panel === 'accounts' ? t("client.chat.switchAccount") : t("client.chat.accountAndComputer")} width={400}
      subtitle={panel === 'accounts' ? t("client.chat.useTheSameChatAccountAsYourComputer") : undefined} onClose={close}
      onBack={panel === 'accounts' && !accounts.saving ? () => setPanel(settings ? null : 'profile') : undefined}>
      {panel === 'profile' && props.variant !== 'settings' ? <div className="chat-detail-stack">
        <p className="chat-muted">{props.email}</p>
        {connectionOptions}
        <button type="button" className="chat-profile-option" aria-label={t("client.app.updateCodexGui")}
          onClick={() => setPanel('update')}><Download size={22} /><span className="chat-grow">
            <strong>{t("client.app.updateCodexGui")}</strong><small>{t("client.app.checkAndUpdateCodexGuiOnThisComputer")}</small>
          </span><span>›</span></button>
      </div> : <div className="chat-detail-stack">
        <input className="chat-answer" aria-label={t("client.chat.searchAccounts")} placeholder={t("client.chat.searchNamesOrNotes")} value={query}
          onChange={event => setQuery(event.target.value)} />
        {!ready && <p className="chat-muted">{t("client.chat.connectToYourComputerToSwitchAccounts")}</p>}
        {accounts.loading && <p role="status">{t("client.chat.syncingAccounts")}</p>}
        {ready && accounts.snapshot && !accounts.snapshot.running && <p className="chat-muted">
          {t("client.chat.chatIsUnavailableOnYourComputerReopenRemoteAiOn")}</p>}
        {accounts.error && <><p role="alert" className="chat-error">{displayError(accounts.error)}</p>
          <button type="button" className="chat-button" disabled={!ready || accounts.loading || Boolean(accounts.saving)}
            onClick={accounts.refresh}>{t("client.chat.reloadAccounts")}</button></>}
        <div className="chat-account-choices chat-scroll">{choices.map(choice => <button type="button"
          key={`${choice.kind}:${choice.id}`} className="chat-profile-option" aria-label={choice.name}
          aria-pressed={choice === current} disabled={disabled || choice === current || !choice.available}
          onClick={() => { void select(choice); }}><span className="chat-grow"><strong>{choice.name}</strong>
            <small>{choice.detail}</small>{!choice.available && <small>{t("client.chat.thisAccountIsUnavailable")}</small>}</span>
          {accounts.saving === `${choice.kind}:${choice.id}` ? t("client.chat.switching") : choice === current && t("client.accounts.current")}</button>)}
          {!choices.length && accounts.snapshot?.running && !accounts.loading && <p className="chat-muted">
            {accounts.snapshot.choices.length ? t("client.chat.noMatchingAccounts") : t("client.chat.noAccountsAvailableAddAnAccountOnYourComputerFirst")}</p>}
        </div>
      </div>}
    </AdaptiveSheet>}
  </>;
}
