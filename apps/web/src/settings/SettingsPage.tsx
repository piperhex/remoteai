import { displayText } from '../i18n/index';
import { getLanguage, t, useLanguage } from '../i18n';
import { petDockText } from '@remoteai/i18n/copy/petDock';
import { QuotaWindowSyncGuidance } from './QuotaWindowSyncGuidance';
import { useState } from 'react';
import { Button, Dialog, Switch } from 'antd-mobile';
import { ChevronRight, Grid2X2, Info, LockKeyhole, LogOut,
  Monitor, PawPrint, RefreshCw, ShieldCheck, Type } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../hooks';
import { signOut } from '../store';
import type { useTotpVault } from '../useTotpVault';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { version } from '../../../../package.json';
import { SettingsRow } from './SettingsRow';
import { DesktopVersionSheet } from './DesktopVersionSheet';
import { loadRefreshMinutes } from './refreshInterval';
import { RefreshIntervalSheet } from './RefreshIntervalSheet';
import { PasswordSheet } from './PasswordSheet';
import { AboutPage } from './AboutPage';
import { LanguageSettingsRow } from './LanguageSettingsRow';
import { ThemeSheet } from './ThemeSheet';
import { ThemeSettingsRow } from './ThemeSettingsRow';
import { profileRole } from '../i18n/profile';
import './styles.css';
import { AutoSaveSettings } from '../../../../shared/project-browser/AutoSaveSettings';
import { JsonHighlightSettings } from '../../../../shared/file-preview/JsonHighlightSettings';
import { useBrowserPreferences } from '../../../../shared/project-browser/useBrowserPreferences';
import { GlobalFontSettings } from '../../../../shared/appearance/GlobalFontSettings';
import { useGlobalFontSize } from '../../../../shared/appearance/fontSize';

type Panel = 'profile' | 'refresh' | 'totp' | 'password' | 'about'
  | 'desktop' | 'theme' | 'files' | 'font' | 'petDock' | null;

export function SettingsPage({ totpManager }: { totpManager: ReturnType<typeof useTotpVault> }) {
  useLanguage();
  const fontSize = useGlobalFontSize();
  const filePreferences = useBrowserPreferences();
  const dispatch = useAppDispatch();
  const session = useAppSelector(state => state.auth.session);
  const profile = useAppSelector(state => state.data.profile) ?? session?.profile;
  const [panel, setPanel] = useState<Panel>(null);
  const [minutes, setMinutes] = useState(loadRefreshMinutes);
  const email = profile?.email || session?.email || '';
  const role = profileRole(profile);
  const close = () => setPanel(null);
  const logout = async () => {
    const confirmed = await Dialog.confirm({ title: t("client.settings.signOutOfThisAccount"),
      content: t("client.settings.youWillNeedToSignInAgainYourCloudData"), confirmText: t("client.app.signOut"), cancelText: t("client.settings.staySignedIn") });
    if (confirmed) void dispatch(signOut());
  };
  if (panel === 'about') return <AboutPage onBack={close} />;
  return <>
    <div className="page-body settings-page">
      <div className="settings-layout"><div className="settings-profile-group">
      <section className="settings-group">
        <button type="button" className="settings-profile" onClick={() => setPanel('profile')} aria-label={t("client.settings.viewProfile")}>
          <span className="settings-avatar">{email.slice(0, 2).toUpperCase()}</span>
          <span><strong>{email}</strong><small>{t("client.settings.remoteAiCloudAccount")}</small></span><ChevronRight size={20} /></button>
      </section>
      <section className="settings-group">
        <ThemeSettingsRow onOpen={() => setPanel('theme')} />
        <LanguageSettingsRow />
      </section>
      </div>
      <div className="settings-preferences">
        <section className="settings-group">
          <SettingsRow label={t('client.appearance.globalFontSize')} value={`${fontSize}px`} icon={Type}
            onClick={() => setPanel('font')} />
          <SettingsRow label={t("client.projectBrowser.fileBrowserSettings")} icon={RefreshCw}
            onClick={() => setPanel('files')} />
          <SettingsRow label={t("client.settings.autoRefreshUsage")} value={t("client.settings.minutes", { value1: minutes })} icon={RefreshCw}
            onClick={() => setPanel('refresh')} />
          <SettingsRow label={t("client.app.2faKeys")} value={totpManager.cloudSyncEnabled ? t("client.settings.on") : t("client.settings.off")} icon={ShieldCheck}
            onClick={() => setPanel('totp')} />
          <SettingsRow label={petDockText(getLanguage(), 'settings.petDock.title')}
            icon={PawPrint} onClick={() => setPanel('petDock')} />
          <QuotaWindowSyncGuidance />
        </section>
        {profile?.role === 'admin' && <section className="settings-group">
          <SettingsRow label={t("client.settings.adminConsole")} icon={Grid2X2}
            onClick={() => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`)} />
        </section>}
        <section className="settings-group"><SettingsRow label={t("client.settings.changePassword")} icon={LockKeyhole} tone="orange"
          onClick={() => setPanel('password')} /></section>
        <section className="settings-group">
          <SettingsRow label={t("client.settings.desktopVersion")} icon={Monitor} tone="blue" onClick={() => setPanel('desktop')} />
          <SettingsRow label={t("client.settings.aboutRemoteAi")} value={`v${version}`}
          icon={Info} tone="blue" onClick={() => setPanel('about')} /></section>
      </div></div>
      <Button className="settings-logout" block color="danger" fill="outline" onClick={() => void logout()}>
        <LogOut size={21} />{t("client.app.signOut")}</Button>
    </div>
    <AdaptiveSheet open={panel === 'petDock'} title={petDockText(getLanguage(), 'settings.petDock.title')}
      onClose={close} width={400}>
      <div className="settings-sync">
        <p>{petDockText(getLanguage(), 'settings.petDock.cloudHint')}</p>
        <p>{petDockText(getLanguage(), 'settings.petDock.labelsHint')}</p>
        <p>{petDockText(getLanguage(), 'settings.petDock.averageHint')}</p>
      </div>
    </AdaptiveSheet>
    <AdaptiveSheet open={panel === 'files'} title={t("client.projectBrowser.fileBrowserSettings")} onClose={close} width={400}>
      <div className="settings-sync"><div>
        <AutoSaveSettings preferences={filePreferences} t={displayText} /><JsonHighlightSettings t={displayText} />
      </div></div>
    </AdaptiveSheet>
    <AdaptiveSheet open={panel === 'font'} title={t('client.appearance.globalFontSize')} onClose={close} width={480}>
      <GlobalFontSettings t={t} />
    </AdaptiveSheet>
    <AdaptiveSheet open={panel === 'profile'} onClose={close} width={400} title={t("client.settings.profile")}>
      <dl className="settings-profile-details"><dt>{t("client.app.email")}</dt><dd>{email}</dd><dt>{t("client.settings.role")}</dt><dd>{role}</dd></dl>
    </AdaptiveSheet>
    <AdaptiveSheet open={panel === 'totp'} title={t("client.app.2faKeys")} onClose={close} width={400}>
      <div className="settings-sync"><div><strong>{t("client.settings.cloudSync")}</strong>
        <p>{t("client.settings.useTheSame2faKeysOnYourPhoneAndThe")}</p></div>
        <Switch aria-label={t("client.settings.cloudSync")} checked={totpManager.cloudSyncEnabled} disabled={totpManager.syncing}
          onChange={totpManager.setCloudSyncEnabled} /></div>
    </AdaptiveSheet>
    {panel === 'refresh' && <RefreshIntervalSheet minutes={minutes} onSaved={setMinutes} onClose={close} />}
    {panel === 'password' && <PasswordSheet onClose={close} />}
    {panel === 'theme' && <ThemeSheet onClose={close} />}
    {panel === 'desktop' && <DesktopVersionSheet onClose={close} />}
  </>;
}
