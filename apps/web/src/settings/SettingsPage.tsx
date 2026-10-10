import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Button, Dialog, Switch } from 'antd-mobile';
import { ChevronRight, Grid2X2, IdCard, Info, LockKeyhole, LogOut,
  Download, Languages, Monitor, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
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
import { LanguageSheet } from './LanguageSheet';
import { ThemeSheet } from './ThemeSheet';
import { useThemeMode } from '../theme/preference';
import { Contrast } from 'lucide-react';
import { getLanguage, languageLabel } from '../i18n';
import { profileRole } from '../i18n/profile';
import './styles.css';
import { DownloadManagerPage } from '../downloads/DownloadManagerPage';
import { downloadOwner } from '../downloads/manager';

type Panel = 'profile' | 'identity' | 'refresh' | 'totp' | 'password' | 'about'
  | 'language' | 'downloads' | 'desktop' | 'theme' | null;

export function SettingsPage({ totpManager }: { totpManager: ReturnType<typeof useTotpVault> }) {
  useLanguage();
  const mode = useThemeMode();
  const dispatch = useAppDispatch();
  const session = useAppSelector(state => state.auth.session);
  const profile = useAppSelector(state => state.data.profile) ?? session?.profile;
  const [panel, setPanel] = useState<Panel>(null);
  const [minutes, setMinutes] = useState(loadRefreshMinutes);
  const email = profile?.email || session?.email || '';
  const role = profileRole(profile);
  const close = () => setPanel(null);
  const logout = async () => {
    const confirmed = await Dialog.confirm({ title: t("退出当前账号？"),
      content: t("退出后需要重新登录，云端数据会保留。"), confirmText: t("退出登录"), cancelText: t("继续使用") });
    if (confirmed) void dispatch(signOut());
  };
  if (panel === 'about') return <AboutPage onBack={close} />;
  if (panel === 'downloads' && session) return <DownloadManagerPage owner={downloadOwner(session)} onBack={close} />;
  return <>
    <div className="page-body settings-page">
      <div className="settings-layout"><section className="settings-group settings-profile-group">
        <button type="button" className="settings-profile" onClick={() => setPanel('profile')} aria-label={t("查看用户信息")}>
          <span className="settings-avatar">{email.slice(0, 2).toUpperCase()}</span>
          <span><strong>{email}</strong><small>{t("Remote AI 云端账号")}</small></span><ChevronRight size={20} /></button>
        <SettingsRow label={t("用户信息")} value={email} icon={UserRound} tone="blue" onClick={() => setPanel('profile')} />
        <SettingsRow label={t("身份信息")} value={role} icon={IdCard} tone="blue" onClick={() => setPanel('identity')} />
      </section>
      <div className="settings-preferences">
        <section className="settings-group">
          <SettingsRow label={t('外观')} value={t(mode === 'dark' ? '暗黑' : '明亮')} icon={Contrast}
            onClick={() => setPanel('theme')} />
          <SettingsRow label={t('下载管理')} icon={Download} onClick={() => setPanel('downloads')} />
          <SettingsRow label={t("语言")} value={languageLabel(getLanguage())} icon={Languages}
            onClick={() => setPanel('language')} />
          <SettingsRow label={t("自动刷新用量")} value={t("{value1} 分钟", { value1: minutes })} icon={RefreshCw}
            onClick={() => setPanel('refresh')} />
          <SettingsRow label={t("2FA 密钥")} value={totpManager.cloudSyncEnabled ? t("已开启") : t("未开启")} icon={ShieldCheck}
            onClick={() => setPanel('totp')} />
        </section>
        {profile?.role === 'admin' && <section className="settings-group">
          <SettingsRow label={t("管理控制台")} icon={Grid2X2}
            onClick={() => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`)} />
        </section>}
        <section className="settings-group"><SettingsRow label={t("修改密码")} icon={LockKeyhole} tone="orange"
          onClick={() => setPanel('password')} /></section>
        <section className="settings-group">
          <SettingsRow label={t('电脑端版本')} icon={Monitor} tone="blue" onClick={() => setPanel('desktop')} />
          <SettingsRow label={t("关于 Remote AI")} value={`v${version}`}
          icon={Info} tone="blue" onClick={() => setPanel('about')} /></section>
      </div></div>
      <Button className="settings-logout" block color="danger" fill="outline" onClick={() => void logout()}>
        <LogOut size={21} />{t("退出登录")}</Button>
    </div>
    <AdaptiveSheet open={panel === 'profile' || panel === 'identity'} onClose={close} width={400}
      title={panel === 'identity' ? t("身份信息") : t("用户信息")}>
      <dl className="settings-profile-details"><dt>{t("邮箱")}</dt><dd>{email}</dd><dt>{t("身份")}</dt><dd>{role}</dd></dl>
    </AdaptiveSheet>
    <AdaptiveSheet open={panel === 'totp'} title={t("2FA 密钥")} onClose={close} width={400}>
      <div className="settings-sync"><div><strong>{t("云端同步")}</strong>
        <p>{t("开启后，在手机和网页上使用同一组 2FA 密钥。")}</p></div>
        <Switch aria-label={t("云端同步")} checked={totpManager.cloudSyncEnabled} disabled={totpManager.syncing}
          onChange={totpManager.setCloudSyncEnabled} /></div>
    </AdaptiveSheet>
    {panel === 'refresh' && <RefreshIntervalSheet minutes={minutes} onSaved={setMinutes} onClose={close} />}
    {panel === 'password' && <PasswordSheet onClose={close} />}
    {panel === 'language' && <LanguageSheet onClose={close} />}
    {panel === 'theme' && <ThemeSheet onClose={close} />}
    {panel === 'desktop' && <DesktopVersionSheet onClose={close} />}
  </>;
}
